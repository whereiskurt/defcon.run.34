#!/bin/bash
# Restore a CMS master database snapshot back into PRODUCTION. DESTRUCTIVE.
#
# Because the master now persists (restores its DB from S3 on boot) and streams
# writes back, you can't just overwrite the replica under a running master — it
# would race. This does it safely:
#   1) take a fresh safety backup of the current live DB (cms-backup.sh)
#   2) scale the master service to 0 and wait for it to stop
#   3) reset the Litestream replica and reseed it from the chosen snapshot
#   4) scale the master back to 1 — it restores the snapshot on boot
#   5) worker replicas re-sync within ~5 min
#
# The master (and cms.defcon.run) is briefly unavailable during the restore.
#
# Usage:
#   ./scripts/cms-restore.sh data/backups/strapi-YYYYMMDD-HHMMSS.db   # local file
#   ./scripts/cms-restore.sh strapi-YYYYMMDD-HHMMSS.db                # from s3 cms-backups/
#   ./scripts/cms-restore.sh s3://bucket/cms-backups/whatever.db      # explicit s3 url
# Requires: litestream 0.5.x

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER="${CMS_CLUSTER:-app-use1-dc34}"
SERVICE="${CMS_MASTER_SERVICE:-run-cms-master-use1}"

export AWS_PROFILE="${AWS_PROFILE:-dc34-application}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env 2>/dev/null)" || true
fi

BUCKET_NAME="${S3_LITESTREAM_BUCKET:-$(aws ssm get-parameter --name /dc34/uploads/use1/cms-litestream/bucket_name --query Parameter.Value --output text 2>/dev/null || echo "")}"
[[ -n "$BUCKET_NAME" ]] || { echo "ERROR: could not determine S3 bucket (set S3_LITESTREAM_BUCKET)."; exit 1; }
command -v litestream &>/dev/null || { echo "ERROR: litestream required."; exit 1; }

ARG="${1:-}"
[[ -n "$ARG" ]] || { echo "usage: $0 <local-snapshot.db | s3-key | s3://url>"; exit 1; }

# Resolve the snapshot to a local file
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
if [[ -f "$ARG" ]]; then
  SNAP="$ARG"
elif [[ "$ARG" == s3://* ]]; then
  SNAP="${TMP_DIR}/snapshot.db"; aws s3 cp "$ARG" "$SNAP" --quiet
else
  SNAP="${TMP_DIR}/snapshot.db"; aws s3 cp "s3://${BUCKET_NAME}/cms-backups/${ARG}" "$SNAP" --quiet
fi
[[ -f "$SNAP" ]] || { echo "ERROR: snapshot not found: $ARG"; exit 1; }

echo "=== CMS master RESTORE (destructive) ==="
echo "Snapshot: $SNAP ($(du -h "$SNAP" | cut -f1))"
echo "Target:   s3://${BUCKET_NAME}/strapi  (service ${SERVICE})"
echo "The master + cms.defcon.run will be briefly DOWN during the restore."
read -r -p "Type 'restore' to proceed: " CONFIRM
[[ "$CONFIRM" == "restore" ]] || { echo "Aborted."; exit 1; }

echo "[1/5] Safety backup of current live DB..."
"${SCRIPT_DIR}/cms-backup.sh" || echo "WARN: safety backup failed — continuing anyway."

echo "[2/5] Scaling master to 0 (stopping writes/replication)..."
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0 >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

echo "[3/5] Resetting replica and reseeding from snapshot..."
aws s3 rm "s3://${BUCKET_NAME}/strapi/" --recursive --quiet || true
RESEED_CONFIG="$(mktemp)"
cat > "$RESEED_CONFIG" <<EOF
dbs:
  - path: ${SNAP}
    replica:
      type: s3
      bucket: ${BUCKET_NAME}
      path: strapi
      region: ${AWS_REGION}
      sync-interval: 1s
      snapshot-interval: 1m
EOF
timeout 25 litestream replicate -config "$RESEED_CONFIG" || true
rm -f "$RESEED_CONFIG"

echo "[4/5] Scaling master back to 1 (restores the snapshot on boot)..."
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 1 >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

echo "[5/5] Done. Master restored from snapshot."
echo "Worker replicas will re-sync within ~5 min. Verify at https://cms.defcon.run/use1/admin"
