#!/usr/bin/env bash
# Download Meshtastic firmware binaries for development.
# These are served from public/firmware/ during dev.
# In production (Phase 4), firmware is vendored into the Docker image.
#
# Usage: ./scripts/download-firmware.sh [version]
#   version defaults to the value in src/config/firmware.ts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(dirname "$SCRIPT_DIR")"
FIRMWARE_DIR="$WEBAPP_DIR/public/firmware"

# Extract version from firmware.ts if not provided
VERSION="${1:-$(grep 'FIRMWARE_VERSION' "$WEBAPP_DIR/src/config/firmware.ts" | head -1 | sed 's/.*"\(.*\)".*/\1/')}"

if [ -z "$VERSION" ]; then
  echo "Error: Could not determine firmware version"
  echo "Usage: $0 [version]"
  exit 1
fi

echo "Firmware version: $VERSION"
echo "Download directory: $FIRMWARE_DIR"

# Create firmware directory
mkdir -p "$FIRMWARE_DIR"

# Meshtastic firmware release URL
# Release tag format: v2.6.6.0a23203
RELEASE_TAG="v${VERSION}"
BASE_URL="https://github.com/meshtastic/firmware/releases/download/${RELEASE_TAG}"

# Download the firmware zip
ZIP_FILE="/tmp/meshtastic-firmware-${VERSION}.zip"
echo ""
echo "Downloading firmware release ${RELEASE_TAG}..."
curl -fL -o "$ZIP_FILE" "${BASE_URL}/firmware-${VERSION}.zip" || {
  echo "Error: Failed to download firmware release ${RELEASE_TAG}"
  echo "Check that the version exists at: https://github.com/meshtastic/firmware/releases"
  exit 1
}

# Extract only factory binaries (*.factory.bin) to firmware directory
echo "Extracting factory binaries..."
TEMP_DIR="/tmp/meshtastic-firmware-extract-$$"
mkdir -p "$TEMP_DIR"
unzip -q -o "$ZIP_FILE" "*.factory.bin" -d "$TEMP_DIR" 2>/dev/null || true

# Move factory binaries to public/firmware/ (they may be nested in subdirectories)
find "$TEMP_DIR" -name "*.factory.bin" -exec mv {} "$FIRMWARE_DIR/" \;

# Count extracted files
COUNT=$(find "$FIRMWARE_DIR" -name "*.factory.bin" | wc -l | tr -d ' ')
echo ""
echo "Extracted $COUNT factory firmware binaries to $FIRMWARE_DIR/"

# Show a few examples
echo ""
echo "Sample files:"
find "$FIRMWARE_DIR" -name "*.factory.bin" | head -5 | while read -r f; do
  SIZE=$(du -h "$f" | cut -f1)
  echo "  $(basename "$f") ($SIZE)"
done

# Clean up
rm -f "$ZIP_FILE"
rm -rf "$TEMP_DIR"

echo ""
echo "Done. Firmware binaries are ready for development."
echo "Note: public/firmware/*.factory.bin is gitignored."
