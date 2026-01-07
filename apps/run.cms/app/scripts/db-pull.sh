#!/bin/bash
# Pull the SQLite database from S3 for local development
# Usage: ./scripts/db-pull.sh
#
# Requires: litestream (brew tap benbjohnson/litestream && brew install litestream)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${APP_DIR}/data"
DB_FILE="${DATA_DIR}/data.db"

# AWS Configuration
export AWS_PROFILE=${AWS_PROFILE:-application}
export AWS_REGION=${AWS_REGION:-us-east-1}

# Export credentials for tools that don't support AWS_PROFILE (like litestream)
# This handles SSO credentials properly
if [[ -z "$AWS_ACCESS_KEY_ID" ]]; then
  echo "Exporting AWS credentials from profile..."
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env 2>/dev/null)" || true
fi

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
if ! command -v litestream &> /dev/null; then
  echo ""
  echo "ERROR: litestream is required but not installed."
  echo "Install with: brew tap benbjohnson/litestream && brew install litestream"
  exit 1
fi

echo "Using Litestream to restore database..."

# Remove existing database (litestream restore requires target not to exist)
if [[ -f "$DB_FILE" ]]; then
  echo "Removing existing database..."
  rm -f "$DB_FILE" "${DB_FILE}-shm" "${DB_FILE}-wal"
fi

# Create temp litestream config
TEMP_CONFIG=$(mktemp)
cat > "$TEMP_CONFIG" <<EOF
dbs:
  - path: ${DB_FILE}
    replica:
      type: s3
      bucket: ${BUCKET_NAME}
      path: strapi
      region: ${AWS_REGION}
EOF

# Check if replica exists first
if ! litestream ltx -config "$TEMP_CONFIG" "$DB_FILE" 2>/dev/null | grep -q "min_txid"; then
  echo ""
  echo "No database backup found in S3. Starting fresh."
  echo "If the CMS has been deployed, data will sync after deployment."
  rm "$TEMP_CONFIG"
  touch "$DB_FILE"
  exit 0
fi

# Restore the database
if litestream restore -config "$TEMP_CONFIG" "$DB_FILE"; then
  rm "$TEMP_CONFIG"
  echo ""
  echo "Database pulled successfully!"
  echo "Size: $(du -h "$DB_FILE" | cut -f1)"
  echo ""
  echo "Run 'npm run develop' to start Strapi with this database."
else
  rm "$TEMP_CONFIG"
  echo ""
  echo "Restore failed. The S3 bucket may be empty or have incompatible data."
  echo "Starting with a fresh database."
  touch "$DB_FILE"
fi
