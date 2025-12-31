#!/bin/bash
# Pull the SQLite database from S3 for local development
# Usage: ./scripts/db-pull.sh

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

echo "=== CMS Database Pull ==="
echo "Bucket: $BUCKET_NAME"
echo "Target: $DB_FILE"

# Create data directory
mkdir -p "$DATA_DIR"

# Check if litestream is installed
if command -v litestream &> /dev/null; then
  echo "Using Litestream to restore database..."

  # Create temp litestream config
  TEMP_CONFIG=$(mktemp)
  cat > "$TEMP_CONFIG" <<EOF
dbs:
  - path: ${DB_FILE}
    replicas:
      - type: s3
        bucket: ${BUCKET_NAME}
        path: strapi
        region: ${AWS_REGION}
EOF

  litestream restore -config "$TEMP_CONFIG" "$DB_FILE"
  rm "$TEMP_CONFIG"
else
  echo "Litestream not found, using direct S3 download..."

  # Download the latest snapshot directly
  # Litestream stores snapshots at: strapi/generations/XXXX/snapshots/XXXX.snapshot.lz4
  LATEST_GEN=$(aws s3 ls "s3://${BUCKET_NAME}/strapi/generations/" | sort | tail -1 | awk '{print $2}' | tr -d '/')

  if [[ -z "$LATEST_GEN" ]]; then
    echo "No database found in S3. Starting fresh."
    touch "$DB_FILE"
    exit 0
  fi

  LATEST_SNAPSHOT=$(aws s3 ls "s3://${BUCKET_NAME}/strapi/generations/${LATEST_GEN}/snapshots/" | sort | tail -1 | awk '{print $4}')

  if [[ -z "$LATEST_SNAPSHOT" ]]; then
    echo "No snapshots found. Starting fresh."
    touch "$DB_FILE"
    exit 0
  fi

  echo "Downloading: s3://${BUCKET_NAME}/strapi/generations/${LATEST_GEN}/snapshots/${LATEST_SNAPSHOT}"
  aws s3 cp "s3://${BUCKET_NAME}/strapi/generations/${LATEST_GEN}/snapshots/${LATEST_SNAPSHOT}" "/tmp/db.snapshot.lz4"

  # Decompress (requires lz4)
  if command -v lz4 &> /dev/null; then
    lz4 -d "/tmp/db.snapshot.lz4" "$DB_FILE"
    rm "/tmp/db.snapshot.lz4"
  else
    echo "ERROR: lz4 not found. Install with: brew install lz4"
    exit 1
  fi
fi

echo ""
echo "Database pulled successfully!"
echo "Size: $(du -h "$DB_FILE" | cut -f1)"
echo ""
echo "Run 'npm run develop' to start Strapi with this database."
