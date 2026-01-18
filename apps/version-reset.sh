#!/bin/bash
# Resets all VERSION files to v0.0.0
# Usage: ./version-reset.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESET_VERSION="v0.0.0"

echo "Resetting all VERSION files to $RESET_VERSION..."
echo ""

find "$SCRIPT_DIR" -name "VERSION" -type f ! -path "*/node_modules/*" | while read -r file; do
  current=$(cat "$file" | tr -d '[:space:]')
  echo "$RESET_VERSION" > "$file"
  echo "Reset $file: $current -> $RESET_VERSION"
done

echo ""
echo "Done."
