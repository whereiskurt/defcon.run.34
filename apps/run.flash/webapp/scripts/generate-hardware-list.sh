#!/usr/bin/env bash
# Regenerate the Meshtastic hardware list for local dev.
# Mirrors the Dockerfile hardware-list stage — same endpoint, same filter,
# same output path — so dev/prod stay in lockstep.
#
# Usage:
#   ./scripts/generate-hardware-list.sh
#
# Behavior:
#   - Fetches https://api.meshtastic.org/resource/deviceHardware.
#   - Retains only entries whose architecture is in
#     {esp32, esp32-s3, esp32-c3, esp32-c6, nrf52840, rp2040}. Everything
#     else (Linux/portduino, STM32, etc.) is dropped — those aren't
#     browser-flashable.
#   - Appends ../extra-devices.json: curated boards that exist in firmware
#     but that api.meshtastic.org doesn't list yet (e.g. T-Beam BPF, merged
#     upstream 2026-07-27). Once the API catches up, the app's hwModel dedup
#     keeps the API entry and the curated one becomes inert.
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

EXTRA_DEVICES="$WEBAPP_DIR/extra-devices.json"

echo "Fetching $DEVICE_HW_API"
curl -fsSL "$DEVICE_HW_API" \
  | jq '[.[] | select(.architecture == "esp32" or .architecture == "esp32-s3" or .architecture == "esp32-c3" or .architecture == "esp32-c6" or .architecture == "nrf52840" or .architecture == "rp2040")]' \
  | jq -s '.[0] + .[1]' - "$EXTRA_DEVICES" \
  > "$OUTPUT.tmp"

if ! jq -e 'length > 0' "$OUTPUT.tmp" > /dev/null; then
  echo "Error: filtered hardware list is empty — refusing to overwrite $OUTPUT" >&2
  rm -f "$OUTPUT.tmp"
  exit 1
fi

mv "$OUTPUT.tmp" "$OUTPUT"

COUNT=$(jq 'length' "$OUTPUT")
echo "Wrote $COUNT ESP32-family hardware entries to $OUTPUT"
