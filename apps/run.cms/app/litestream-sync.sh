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
    # Checkpoint WAL into main database file and remove WAL/SHM for clean start
    sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);"
    rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"
    echo "WAL checkpointed and cleaned for initial restore"
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

    # Restore to an isolated temp directory to avoid polluting the live database
    TEMP_DIR=$(mktemp -d)
    TEMP_DB="${TEMP_DIR}/strapi.db"

    if $LITESTREAM restore -config "$CONFIG" -o "$TEMP_DB" "$DB_PATH" 2>/dev/null; then
        # Checkpoint the restored database to fold WAL into the main file
        sqlite3 "$TEMP_DB" "PRAGMA wal_checkpoint(TRUNCATE);"
        # Remove any WAL/SHM files from the restored database (should be clean after checkpoint)
        rm -f "${TEMP_DB}-wal" "${TEMP_DB}-shm"

        # Stop Strapi briefly for a safe file swap
        supervisorctl stop strapi 2>/dev/null

        # Remove old WAL/SHM files to prevent stale WAL application on the new database
        rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

        # Move the checkpointed database into place
        mv "$TEMP_DB" "$DB_PATH"

        # Restart Strapi
        supervisorctl start strapi 2>/dev/null

        echo "$(date '+%Y-%m-%d %H:%M:%S') - Sync completed successfully"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Sync failed or no new data"
    fi

    # Clean up temp directory in all cases
    rm -rf "$TEMP_DIR"
done
