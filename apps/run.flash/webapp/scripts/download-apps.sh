#!/usr/bin/env bash
# Mirror the pinned phone-app APKs for local dev (Dockerfile parity).
# Reads app-downloads.sources.json; writes public/apps/ + refreshes the
# tracked public/data/apps-manifest.json snapshot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(dirname "$SCRIPT_DIR")"
SRC="$WEBAPP_DIR/app-downloads.sources.json"
APPS_DIR="$WEBAPP_DIR/public/apps"

mkdir -p "$APPS_DIR"

COUNT=$(jq '[.apps[] | select(.kind == "apk")] | length' "$SRC")
for ((i = 0; i < COUNT; i++)); do
  URL=$(jq -r "[.apps[] | select(.kind == \"apk\")][$i].url" "$SRC")
  FN=$(jq -r "[.apps[] | select(.kind == \"apk\")][$i].filename" "$SRC")
  echo "Downloading $FN ..."
  curl -fL --retry 3 -o "$APPS_DIR/$FN" "$URL"
done

jq '{apps: [.apps[] | del(.url)]}' "$SRC" > "$WEBAPP_DIR/public/data/apps-manifest.json"
echo "Mirrored $COUNT APKs to $APPS_DIR and refreshed apps-manifest.json"
