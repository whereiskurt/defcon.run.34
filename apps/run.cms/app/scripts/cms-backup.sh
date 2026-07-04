#!/bin/bash
# Point-in-time snapshot of the LIVE CMS master database.
#
# The master continuously replicates to s3://<bucket>/strapi (Litestream), and
# workers restore from it. This captures a named, directly-restorable .db copy
# on top of that stream — kept in BOTH a dated S3 key and a local file. Pairs
# with cms-restore.sh.
#
# Usage: ./scripts/cms-backup.sh
# Requires: litestream 0.5.x (brew tap benbjohnson/litestream && brew install litestream)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${APP_DIR}/data/backups"

export AWS_PROFILE="${AWS_PROFILE:-dc34-application}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

# Export static creds for litestream (doesn't read AWS_PROFILE / SSO directly)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env 2>/dev/null)" || true
fi

BUCKET_NAME="${S3_LITESTREAM_BUCKET:-$(aws ssm get-parameter --name /dc34/uploads/use1/cms-litestream/bucket_name --query Parameter.Value --output text 2>/dev/null || echo "")}"
if [[ -z "$BUCKET_NAME" ]]; then
  echo "ERROR: could not determine S3 bucket (set S3_LITESTREAM_BUCKET)."; exit 1
fi
if ! command -v litestream &>/dev/null; then
  echo "ERROR: litestream required (brew tap benbjohnson/litestream && brew install litestream)"; exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
LOCAL_DB="${BACKUP_DIR}/strapi-${TS}.db"
S3_KEY="cms-backups/strapi-${TS}.db"

TEMP_CONFIG="$(mktemp)"
trap 'rm -f "$TEMP_CONFIG"' EXIT
cat > "$TEMP_CONFIG" <<EOF
dbs:
  - path: ${LOCAL_DB}
    replica:
      type: s3
      bucket: ${BUCKET_NAME}
      path: strapi
      region: ${AWS_REGION}
EOF

echo "=== CMS master backup ==="
echo "Replica: s3://${BUCKET_NAME}/strapi"

if ! litestream ltx -config "$TEMP_CONFIG" "$LOCAL_DB" 2>/dev/null | grep -q min_txid; then
  echo "ERROR: no Litestream replica found — nothing to back up."; exit 1
fi

litestream restore -config "$TEMP_CONFIG" "$LOCAL_DB"
aws s3 cp "$LOCAL_DB" "s3://${BUCKET_NAME}/${S3_KEY}" --quiet

echo "Backup complete ($(du -h "$LOCAL_DB" | cut -f1)):"
echo "  local: ${LOCAL_DB}"
echo "  s3:    s3://${BUCKET_NAME}/${S3_KEY}"
