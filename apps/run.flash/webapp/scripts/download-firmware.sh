#!/usr/bin/env bash
# Download Meshtastic firmware images for local dev — Dockerfile Stage 1 parity.
#
# Usage:
#   ./scripts/download-firmware.sh                 # all slots from firmware-versions.json
#   ./scripts/download-firmware.sh 2.5.19.f81a3f7  # legacy: single explicit version
#
# Behavior:
#   - Reads ../firmware-versions.json (slots: stable/previous/nightly) and
#     mirrors the Dockerfile logic: pinned slots pull GitHub release arch zips
#     (esp32 esp32s3 esp32c3 esp32c6 nrf52840 rp2040, factory.bin + uf2);
#     the nightly slot resolves meshtastic.github.io firmware-nightly and
#     fetches per-target files derived from public/data/hardware-list.json.
#   - Writes/overwrites public/data/firmware-manifest.json (tracked snapshot).
#   - Writes NEXT_PUBLIC_FIRMWARE_VERSION=<default slot version> to .env.local.
#
# Fails fast on non-2xx HTTP for pinned slots; nightly misses warn-and-continue.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(dirname "$SCRIPT_DIR")"
FIRMWARE_DIR="$WEBAPP_DIR/public/firmware"
CFG="$WEBAPP_DIR/firmware-versions.json"
HW_LIST="$WEBAPP_DIR/public/data/hardware-list.json"
MANIFEST="$WEBAPP_DIR/public/data/firmware-manifest.json"

FIRMWARE_LIST_API="https://api.meshtastic.org/github/firmware/list"
NIGHTLY_BASE="https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/firmware-nightly"

mkdir -p "$FIRMWARE_DIR"

download_release_zips() {
  local ver="$1"
  local base_url="https://github.com/meshtastic/firmware/releases/download/v${ver}"
  local tmp_dir
  tmp_dir=$(mktemp -d)
  for arch in esp32 esp32s3 esp32c3 esp32c6 nrf52840 rp2040; do
    local zip_name="firmware-${arch}-${ver}.zip"
    echo "Downloading ${zip_name}..."
    if ! curl -fL --retry 3 -o "$tmp_dir/$zip_name" "${base_url}/${zip_name}"; then
      echo "Warning: Failed to download ${zip_name} — skipping"
      continue
    fi
    unzip -q -o "$tmp_dir/$zip_name" "firmware-*.factory.bin" -d "$tmp_dir" 2>/dev/null || true
    unzip -q -o "$tmp_dir/$zip_name" "firmware-*.uf2" -d "$tmp_dir" 2>/dev/null || true
    /bin/rm -f "$tmp_dir/$zip_name"
  done
  find "$tmp_dir" -name "*-update.bin" -delete 2>/dev/null || true
  find "$tmp_dir" \( -name "firmware-*.factory.bin" -o -name "firmware-*.uf2" \) -exec mv -f {} "$FIRMWARE_DIR/" \;
  /bin/rm -rf "$tmp_dir"
  local count
  count=$(find "$FIRMWARE_DIR" -name "firmware-*-${ver}.*" | wc -l | tr -d ' ')
  echo "Slot files for ${ver}: ${count}"
  [ "$count" -gt 0 ] || { echo "ERROR: version ${ver} produced zero firmware files" >&2; exit 1; }
}

download_nightly() {
  local ver="$1" got=0 miss=0
  while read -r target; do
    if curl -fsSL --retry 2 -o "$FIRMWARE_DIR/firmware-${target}-${ver}.factory.bin" \
      "$NIGHTLY_BASE/firmware-${target}-${ver}.factory.bin"; then got=$((got + 1)); else
      /bin/rm -f "$FIRMWARE_DIR/firmware-${target}-${ver}.factory.bin"; miss=$((miss + 1)); fi
  done < <(jq -r '.[] | select(.architecture | startswith("esp32")) | .platformioTarget' "$HW_LIST" | sort -u)
  while read -r target; do
    if curl -fsSL --retry 2 -o "$FIRMWARE_DIR/firmware-${target}-${ver}.uf2" \
      "$NIGHTLY_BASE/firmware-${target}-${ver}.uf2"; then got=$((got + 1)); else
      /bin/rm -f "$FIRMWARE_DIR/firmware-${target}-${ver}.uf2"; miss=$((miss + 1)); fi
  done < <(jq -r '.[] | select(.architecture == "nrf52840" or .architecture == "rp2040") | .platformioTarget' "$HW_LIST" | sort -u)
  echo "Nightly ${ver}: ${got} targets fetched, ${miss} missing (warn-only)"
  [ "$got" -gt 0 ] || { echo "ERROR: nightly fetched zero targets" >&2; exit 1; }
}

write_env_default() {
  local ver="$1"
  local env_file="$WEBAPP_DIR/.env.local"
  touch "$env_file"
  grep -v '^NEXT_PUBLIC_FIRMWARE_VERSION=' "$env_file" > "$env_file.tmp" || true
  echo "NEXT_PUBLIC_FIRMWARE_VERSION=$ver" >> "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  echo "Wrote NEXT_PUBLIC_FIRMWARE_VERSION=$ver to $env_file"
}

# Legacy single-version mode: pin one explicit version, keep the old contract.
if [ -n "${1:-}" ]; then
  VERSION="$1"
  echo "Single-version mode: $VERSION"
  download_release_zips "$VERSION"
  write_env_default "$VERSION"
  echo "Done (manifest NOT rewritten in single-version mode)."
  exit 0
fi

[ -f "$HW_LIST" ] || { echo "ERROR: $HW_LIST missing — run scripts/generate-hardware-list.sh first" >&2; exit 1; }

COUNT=$(jq '.versions | length' "$CFG")
ENTRIES_FILE=$(mktemp)
DEFAULT_VER=""

for ((i = 0; i < COUNT; i++)); do
  SLOT=$(jq -r ".versions[$i].slot" "$CFG")
  PIN=$(jq -r ".versions[$i].pin" "$CFG")
  LABEL=$(jq -r ".versions[$i].label" "$CFG")
  IS_DEFAULT=$(jq -r ".versions[$i].default // false" "$CFG")
  IS_EXP=$(jq -r ".versions[$i].experimental // false" "$CFG")

  if [ -n "$PIN" ]; then
    FW_VER="$PIN"
  elif [ "$SLOT" = "nightly" ]; then
    FW_VER=$(curl -fsSL "$NIGHTLY_BASE/index.json" | jq -r '.version')
  else
    FW_VER=$(curl -fsSL "$FIRMWARE_LIST_API" | jq -r '.releases.stable[0].id' | sed 's/^v//')
  fi
  if [ -z "$FW_VER" ] || [ "$FW_VER" = "null" ]; then
    echo "ERROR: could not resolve version for slot $SLOT" >&2
    exit 1
  fi

  echo ""
  echo "=== Slot $SLOT -> $FW_VER ==="
  if [ "$SLOT" = "nightly" ] && [ -z "$PIN" ]; then
    download_nightly "$FW_VER"
  else
    download_release_zips "$FW_VER"
  fi

  jq -n --arg slot "$SLOT" --arg version "$FW_VER" --arg label "$LABEL" \
    --argjson default "$IS_DEFAULT" --argjson experimental "$IS_EXP" \
    '{slot:$slot, version:$version, label:$label, default:$default, experimental:$experimental}' \
    >> "$ENTRIES_FILE"
  if [ "$IS_DEFAULT" = "true" ]; then DEFAULT_VER="$FW_VER"; fi
done

jq -s '{versions: .}' "$ENTRIES_FILE" > "$MANIFEST"
/bin/rm -f "$ENTRIES_FILE"
[ -n "$DEFAULT_VER" ] || { echo "ERROR: no default slot in $CFG" >&2; exit 1; }

echo ""
echo "Wrote $(jq '.versions | length' "$MANIFEST") versions to $MANIFEST"
write_env_default "$DEFAULT_VER"

echo ""
echo "Done. Firmware binaries are ready for development."
echo "Note: public/firmware/* binaries are gitignored."
