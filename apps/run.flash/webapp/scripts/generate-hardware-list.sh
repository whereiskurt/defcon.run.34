#!/usr/bin/env bash
# Regenerate the ESP32-only Meshtastic hardware list for local dev.
# Mirrors the Dockerfile hardware-list stage 18-03 will introduce — same
# endpoint, same filter, same output path — so dev/prod stay in lockstep.
#
# Usage:
#   ./scripts/generate-hardware-list.sh
#
# Behavior:
#   - Fetches https://api.meshtastic.org/resource/deviceHardware.
#   - Retains only entries whose architecture is in
#     {esp32, esp32-s3, esp32-c3, esp32-c6}. Everything else (nRF52, Linux,
#     STM32, RP2xxx, etc.) is dropped — flasher targets ESP32 families only.
#   - Overwrites apps/run.flash/webapp/public/data/hardware-list.json
#     atomically (write to .tmp, validate, mv into place).
#
# Fails fast on non-2xx HTTP and on an empty result array.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(dirname "$SCRIPT_DIR")"

DEVICE_HW_API="https://api.meshtastic.org/resource/deviceHardware"
OUTPUT="$WEBAPP_DIR/public/data/hardware-list.json"

mkdir -p "$(dirname "$OUTPUT")"

echo "Fetching $DEVICE_HW_API"
curl -fsSL "$DEVICE_HW_API" \
  | jq '[.[] | select(.architecture == "esp32" or .architecture == "esp32-s3" or .architecture == "esp32-c3" or .architecture == "esp32-c6")]' \
  > "$OUTPUT.tmp"

if ! jq -e 'length > 0' "$OUTPUT.tmp" > /dev/null; then
  echo "Error: filtered hardware list is empty — refusing to overwrite $OUTPUT" >&2
  rm -f "$OUTPUT.tmp"
  exit 1
fi

mv "$OUTPUT.tmp" "$OUTPUT"

COUNT=$(jq 'length' "$OUTPUT")
echo "Wrote $COUNT ESP32-family hardware entries to $OUTPUT"
