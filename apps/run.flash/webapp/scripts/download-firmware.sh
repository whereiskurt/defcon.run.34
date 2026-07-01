#!/usr/bin/env bash
# Download Meshtastic factory firmware images for local dev.
# Mirrors the Dockerfile Stage 1 behavior for dev/prod parity (see Phase 18).
#
# Usage:
#   ./scripts/download-firmware.sh              # resolve latest stable via API
#   ./scripts/download-firmware.sh 2.5.19.f81a3f7  # pin explicit version
#
# Behavior:
#   - If a version is passed, uses it verbatim.
#   - Otherwise resolves releases.stable[0].id from
#     https://api.meshtastic.org/github/firmware/list (no hardcoded fallback).
#   - Extracts firmware-{target}-{version}.factory.bin (bootable at 0x00) for
#     each ESP32 family (esp32, esp32s3, esp32c3, esp32c6) into public/firmware/.
#   - Writes/replaces NEXT_PUBLIC_FIRMWARE_VERSION=<version> in
#     apps/run.flash/webapp/.env.local so `next dev` picks it up automatically.
#
# Fails fast on non-2xx HTTP and on empty resolved version.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(dirname "$SCRIPT_DIR")"
FIRMWARE_DIR="$WEBAPP_DIR/public/firmware"

FIRMWARE_LIST_API="https://api.meshtastic.org/github/firmware/list"

if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  VERSION="$(curl -fsSL "$FIRMWARE_LIST_API" | jq -r '.releases.stable[0].id' | sed 's/^v//')"
fi

if [ -z "${VERSION:-}" ] || [ "$VERSION" = "null" ]; then
  echo "Error: could not resolve firmware version from ${FIRMWARE_LIST_API}" >&2
  echo "Pass an explicit version: $0 <version>" >&2
  exit 1
fi

echo "Firmware version: $VERSION"
echo "Download directory: $FIRMWARE_DIR"

mkdir -p "$FIRMWARE_DIR"

RELEASE_TAG="v${VERSION}"
BASE_URL="https://github.com/meshtastic/firmware/releases/download/${RELEASE_TAG}"

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

  # Extract only the bootable factory images (bootloader + partition table + app at 0x00).
  unzip -q -o "$ZIP_FILE" "firmware-*.factory.bin" -d "$TEMP_DIR" 2>/dev/null || true
  # Defense-in-depth: if any *-update.bin leaked in, drop it.
  find "$TEMP_DIR" -name "*-update.bin" -delete 2>/dev/null || true
  rm -f "$ZIP_FILE"
done

find "$TEMP_DIR" -name "firmware-*.factory.bin" -exec mv {} "$FIRMWARE_DIR/" \;

COUNT=$(find "$FIRMWARE_DIR" -name "firmware-*.factory.bin" | wc -l | tr -d ' ')
echo ""
echo "Extracted $COUNT factory firmware binaries to $FIRMWARE_DIR/"

echo ""
echo "Sample files:"
find "$FIRMWARE_DIR" -name "firmware-*.factory.bin" | head -5 | while read -r f; do
  SIZE=$(du -h "$f" | cut -f1)
  echo "  $(basename "$f") ($SIZE)"
done

rm -rf "$TEMP_DIR"

# Idempotently write NEXT_PUBLIC_FIRMWARE_VERSION into .env.local so `next dev`
# reads the resolved version without any source edits.
ENV_FILE="$WEBAPP_DIR/.env.local"
touch "$ENV_FILE"
grep -v '^NEXT_PUBLIC_FIRMWARE_VERSION=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
echo "NEXT_PUBLIC_FIRMWARE_VERSION=$VERSION" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo ""
echo "Wrote NEXT_PUBLIC_FIRMWARE_VERSION=$VERSION to $ENV_FILE"

echo ""
echo "Done. Firmware binaries are ready for development."
echo "Note: public/firmware/*.bin is gitignored."
