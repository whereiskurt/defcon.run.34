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
RELEASE_TAG="v${VERSION}"
BASE_URL="https://github.com/meshtastic/firmware/releases/download/${RELEASE_TAG}"

# ESP32 architecture zips — one per chip family
ARCH_ZIPS=(
  "firmware-esp32-${VERSION}.zip"
  "firmware-esp32s3-${VERSION}.zip"
  "firmware-esp32c3-${VERSION}.zip"
  "firmware-esp32c6-${VERSION}.zip"
)

TEMP_DIR="/tmp/meshtastic-firmware-extract-$$"
mkdir -p "$TEMP_DIR"

for ZIP_NAME in "${ARCH_ZIPS[@]}"; do
  ZIP_FILE="/tmp/${ZIP_NAME}"
  echo ""
  echo "Downloading ${ZIP_NAME}..."
  curl -fL -o "$ZIP_FILE" "${BASE_URL}/${ZIP_NAME}" || {
    echo "Warning: Failed to download ${ZIP_NAME} — skipping"
    continue
  }

  # Extract firmware binaries (firmware-*.bin) excluding update and littlefs variants
  unzip -q -o "$ZIP_FILE" "firmware-*.bin" -d "$TEMP_DIR" 2>/dev/null || true
  # Remove update binaries — we only want the full firmware
  find "$TEMP_DIR" -name "*-update.bin" -delete 2>/dev/null || true
  rm -f "$ZIP_FILE"
done

# Move firmware binaries to public/firmware/ (they may be nested in subdirectories)
find "$TEMP_DIR" -name "firmware-*.bin" -exec mv {} "$FIRMWARE_DIR/" \;

# Count extracted files
COUNT=$(find "$FIRMWARE_DIR" -name "firmware-*.bin" | wc -l | tr -d ' ')
echo ""
echo "Extracted $COUNT factory firmware binaries to $FIRMWARE_DIR/"

# Show a few examples
echo ""
echo "Sample files:"
find "$FIRMWARE_DIR" -name "firmware-*.bin" | head -5 | while read -r f; do
  SIZE=$(du -h "$f" | cut -f1)
  echo "  $(basename "$f") ($SIZE)"
done

# Clean up
rm -rf "$TEMP_DIR"

echo ""
echo "Done. Firmware binaries are ready for development."
echo "Note: public/firmware/*.bin is gitignored."
