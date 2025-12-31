#!/bin/bash
# Push the local SQLite database to S3 for deployment
# This replaces the production database - use with caution!
# Usage: ./scripts/db-push.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${APP_DIR}/data"
DB_FILE="${DATA_DIR}/data.db"

# AWS Configuration
export AWS_PROFILE=${AWS_PROFILE:-application}
export AWS_REGION=${AWS_REGION:-us-east-1}

# Get bucket name from SSM or use default
BUCKET_NAME=${S3_LITESTREAM_BUCKET:-$(aws ssm get-parameter --name "/dc34/uploads/use1/cms-litestream/bucket_name" --query "Parameter.Value" --output text 2>/dev/null || echo "")}

if [[ -z "$BUCKET_NAME" ]]; then
  echo "ERROR: Could not determine S3 bucket name."
  echo "Set S3_LITESTREAM_BUCKET env var or ensure SSM parameter exists."
  exit 1
fi

if [[ ! -f "$DB_FILE" ]]; then
  echo "ERROR: Database file not found: $DB_FILE"
  echo "Run 'npm run develop' first to create a database."
  exit 1
fi

echo "=== CMS Database Push ==="
echo "Source: $DB_FILE"
echo "Bucket: $BUCKET_NAME"
echo "Size: $(du -h "$DB_FILE" | cut -f1)"
echo ""
echo "⚠️  WARNING: This will replace the production database!"
echo "    All workers will sync to this new database."
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

# Create a backup first
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_KEY="strapi/backups/pre-push-${TIMESTAMP}.db"

echo ""
echo "Creating backup at s3://${BUCKET_NAME}/${BACKUP_KEY}..."

# Try to backup existing database
if aws s3 ls "s3://${BUCKET_NAME}/strapi/generations/" &>/dev/null; then
  # Get latest generation for backup reference
  LATEST_GEN=$(aws s3 ls "s3://${BUCKET_NAME}/strapi/generations/" | sort | tail -1 | awk '{print $2}' | tr -d '/')
  if [[ -n "$LATEST_GEN" ]]; then
    LATEST_SNAPSHOT=$(aws s3 ls "s3://${BUCKET_NAME}/strapi/generations/${LATEST_GEN}/snapshots/" | sort | tail -1 | awk '{print $4}')
    if [[ -n "$LATEST_SNAPSHOT" ]]; then
      aws s3 cp "s3://${BUCKET_NAME}/strapi/generations/${LATEST_GEN}/snapshots/${LATEST_SNAPSHOT}" "s3://${BUCKET_NAME}/${BACKUP_KEY}.lz4" --quiet
      echo "Backup created."
    fi
  fi
fi

# Push using Litestream if available, otherwise direct upload
if command -v litestream &> /dev/null; then
  echo "Using Litestream to replicate database..."

  # Create temp litestream config for one-time replication
  TEMP_CONFIG=$(mktemp)
  cat > "$TEMP_CONFIG" <<EOF
dbs:
  - path: ${DB_FILE}
    replicas:
      - type: s3
        bucket: ${BUCKET_NAME}
        path: strapi
        region: ${AWS_REGION}
        sync-interval: 1s
        snapshot-interval: 1m
EOF

  # Run litestream replicate for a short time to push changes
  echo "Replicating to S3 (this may take a moment)..."
  timeout 30 litestream replicate -config "$TEMP_CONFIG" || true
  rm "$TEMP_CONFIG"
else
  echo "Litestream not found, using direct S3 upload..."

  # Compress and upload
  TEMP_FILE="/tmp/db-push-${TIMESTAMP}.db.lz4"

  if command -v lz4 &> /dev/null; then
    lz4 "$DB_FILE" "$TEMP_FILE"

    # Upload to a known location that workers can restore from
    aws s3 cp "$TEMP_FILE" "s3://${BUCKET_NAME}/strapi/seed/latest.db.lz4"
    rm "$TEMP_FILE"
  else
    # Direct upload without compression
    aws s3 cp "$DB_FILE" "s3://${BUCKET_NAME}/strapi/seed/latest.db"
  fi
fi

echo ""
echo "Database pushed successfully!"
echo ""
echo "Next steps:"
echo "  1. Restart the CMS master service to pick up changes"
echo "  2. Workers will auto-sync within 5 minutes"
