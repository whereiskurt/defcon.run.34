#!/bin/bash
# Litestream sync script for CMS Workers
# Performs initial restore, then periodic sync every 5 minutes

set -e

LITESTREAM=/usr/local/bin/litestream
CONFIG=/etc/litestream/litestream.yml
DB_PATH=${DATABASE_FILENAME:-/data/strapi.db}
DB_DIR=$(dirname "$DB_PATH")
READY_FLAG=/data/.db-ready
SYNC_INTERVAL=${SYNC_INTERVAL:-300}  # 5 minutes

# Create data directory if it doesn't exist
mkdir -p "$DB_DIR"

# Remove ready flag to prevent Strapi from starting during restore
rm -f "$READY_FLAG"

echo "=== Litestream Worker Sync ==="
echo "Database path: $DB_PATH"
echo "Sync interval: ${SYNC_INTERVAL}s"

# Initial restore from S3
echo "Performing initial restore from S3..."
if $LITESTREAM restore -config "$CONFIG" "$DB_PATH"; then
    echo "Database restored successfully"
else
    echo "No existing database in S3 or restore failed"
    echo "Creating empty database file..."
    touch "$DB_PATH"
fi

# Set ready flag to allow Strapi to start
touch "$READY_FLAG"
echo "Database ready, Strapi can start"

# Periodic sync loop
while true; do
    sleep "$SYNC_INTERVAL"

    echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting periodic sync..."

    # Stop Strapi to safely update database
    # Note: This causes brief downtime, but ensures data consistency
    # Alternative: Use SQLite WAL mode for hot backup (future improvement)

    # For now, we do a "hot" restore by:
    # 1. Downloading to a temp file
    # 2. Swapping atomically if successful
    TEMP_DB="${DB_PATH}.new"

    if $LITESTREAM restore -config "$CONFIG" -o "$TEMP_DB" "$DB_PATH" 2>/dev/null; then
        # Atomic swap
        mv "$TEMP_DB" "$DB_PATH"
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Sync completed successfully"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Sync failed or no new data"
        rm -f "$TEMP_DB"
    fi
done
