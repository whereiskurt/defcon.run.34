#!/usr/bin/env bash
# Snapshot every DC34 data store into s3://defcon.run.34.backup before teardown.
#
#   scripts/dc34-backup/snapshot.sh            # do it
#   scripts/dc34-backup/snapshot.sh --dry-run  # print what would run
#
# Only ever creates and writes. Never deletes. Safe to re-run: each run lands
# under snapshots/<stamp>/ and DDB exports are additive.
#
# Layout written:
#   ddb/<table>/schema.json                 describe-table (for restore create-table)
#   ddb/<table>/AWSDynamoDB/<exportId>/…    native export (DYNAMODB_JSON, same as DC33)
#   ddb/<table>/LATEST                      exportId of the newest completed export
#   s3/<source-bucket>/…                    aws s3 sync of each data bucket
#   ssm/<stamp>.secrets.sops.json           SSM params, decrypted then sops/KMS-encrypted
#   snapshots/<stamp>/MANIFEST.json         counts + export ids for this run
#   LATEST                                  stamp of the newest run
set -euo pipefail

BUCKET="defcon.run.34.backup"
REGION="us-east-1"
export AWS_PROFILE="${AWS_PROFILE:-dc34-application}"
KMS_ARN="arn:aws:kms:us-east-1:427284555693:alias/sops"   # account-level key, NOT in this Terraform tree
TABLES=(run-auth-authjs run-auth-electro run-gpx-electro run-human-authjs run-human-electro run-quota-electro)
SRC_BUCKETS=(
  uploads-dc34-run-gpx-use1-80a6b349
  uploads-dc34-cms-litestream-use1-80a6b349   # the Strapi SQLite DB replica
  uploads-dc34-cms-media-use1-80a6b349
  ses-inbox-dc34-use1-80a6b349
  dc34-redirect-pages-80a6b349
  status-dc34-use1-e8d864bdfaf2
)
SSM_PATHS=(/dc34 /defcon.run)
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

run() { if (( DRY )); then echo "+ $*"; else "$@"; fi; }
aws1() { aws --region "$REGION" "$@"; }
say() { printf '\n== %s\n' "$*"; }

say "0. preflight"
aws1 sts get-caller-identity --query Account --output text >/dev/null || { echo "not logged in: aws sso login --profile $AWS_PROFILE"; exit 1; }
command -v sops >/dev/null || { echo "sops missing (brew install sops)"; exit 1; }

say "1. backup bucket $BUCKET (outside Terraform on purpose)"
if aws1 s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then echo "exists"; else
  run aws1 s3api create-bucket --bucket "$BUCKET"
  run aws1 s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
  run aws1 s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  run aws1 s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  # a just-created bucket can 404 on list for a few seconds; wait for it to settle
  (( DRY )) || until aws1 s3api list-objects-v2 --bucket "$BUCKET" --max-keys 1 >/dev/null 2>&1; do sleep 3; done
fi

say "2. DynamoDB: save schema + kick off point-in-time exports"
declare -A EXPORT_ARN
for t in "${TABLES[@]}"; do
  aws1 dynamodb describe-table --table-name "$t" --query Table > "$WORK/$t.schema.json"
  run aws1 s3 cp "$WORK/$t.schema.json" "s3://$BUCKET/ddb/$t/schema.json" --quiet
  if (( DRY )); then echo "+ export-table-to-point-in-time $t -> s3://$BUCKET/ddb/$t/"; continue; fi
  EXPORT_ARN[$t]="$(aws1 dynamodb export-table-to-point-in-time \
    --table-arn "$(jq -r .TableArn "$WORK/$t.schema.json")" \
    --s3-bucket "$BUCKET" --s3-prefix "ddb/$t" --export-format DYNAMODB_JSON \
    --query ExportDescription.ExportArn --output text)"
  echo "$t -> ${EXPORT_ARN[$t]##*/}"
done

say "3. S3: sync data buckets"
for b in "${SRC_BUCKETS[@]}"; do
  run aws1 s3 sync "s3://$b" "s3://$BUCKET/s3/$b" --only-show-errors
  echo "synced $b"
done

say "4. SSM: dump parameters (decrypted) and sops-encrypt with $KMS_ARN"
for p in "${SSM_PATHS[@]}"; do
  aws1 ssm get-parameters-by-path --path "$p" --recursive --with-decryption --query 'Parameters[].{Name:Name,Type:Type,Value:Value}' --output json
done | jq -s '{parameters: (add | sort_by(.Name))}' > "$WORK/ssm.json"
echo "$(jq '.parameters | length' "$WORK/ssm.json") parameters"
if (( ! DRY )); then
  sops --config /dev/null --encrypt --kms "$KMS_ARN" --input-type json --output-type json "$WORK/ssm.json" > "$WORK/ssm.enc.json"
  aws1 s3 cp "$WORK/ssm.enc.json" "s3://$BUCKET/ssm/$STAMP.secrets.sops.json" --quiet
fi

say "5. wait for DDB exports, then write manifest"
(( DRY )) && { echo "+ (poll describe-export until COMPLETED; write snapshots/$STAMP/MANIFEST.json)"; exit 0; }
manifest="$WORK/MANIFEST.json"; echo '{"stamp":"'"$STAMP"'","bucket":"'"$BUCKET"'","tables":{},"buckets":{}}' > "$manifest"
for t in "${TABLES[@]}"; do
  arn="${EXPORT_ARN[$t]}"
  until [[ "$(aws1 dynamodb describe-export --export-arn "$arn" --query ExportDescription.ExportStatus --output text)" != "IN_PROGRESS" ]]; do sleep 15; done
  d="$(aws1 dynamodb describe-export --export-arn "$arn" --query 'ExportDescription.{status:ExportStatus,items:ItemCount,bytes:BilledSizeBytes,fail:FailureMessage}')"
  [[ "$(jq -r .status <<<"$d")" == "COMPLETED" ]] || { echo "EXPORT FAILED $t: $d"; exit 1; }
  echo "${arn##*/}" | run aws1 s3 cp - "s3://$BUCKET/ddb/$t/LATEST" --quiet
  approx="$(jq -r .ItemCount "$WORK/$t.schema.json")"
  jq --arg t "$t" --arg id "${arn##*/}" --argjson d "$d" --argjson approx "$approx" \
     '.tables[$t] = {exportId:$id, exportedItems:$d.items, describeTableItemCount:$approx}' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
  printf '%-20s exported=%-6s describe-table≈%s\n' "$t" "$(jq -r .items <<<"$d")" "$approx"
done
for b in "${SRC_BUCKETS[@]}"; do
  # --query runs per page (1000 keys), so sum the lines
  n="$(aws1 s3api list-objects-v2 --bucket "$BUCKET" --prefix "s3/$b/" --query 'length(Contents || `[]`)' --output text | paste -sd+ - | bc)"
  jq --arg b "$b" --argjson n "$n" '.buckets[$b] = $n' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
done
aws1 s3 cp "$manifest" "s3://$BUCKET/snapshots/$STAMP/MANIFEST.json" --quiet
echo "$STAMP" | aws1 s3 cp - "s3://$BUCKET/LATEST" --quiet
say "done: s3://$BUCKET/snapshots/$STAMP/MANIFEST.json"
jq . "$manifest"
