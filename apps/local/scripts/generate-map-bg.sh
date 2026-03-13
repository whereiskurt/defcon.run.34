#!/bin/bash
# Generate map background images for any city
#
# Usage (from repo root):
#   ./apps/local/scripts/generate-map-bg.sh "Las Vegas, Nevada"
#   ./apps/local/scripts/generate-map-bg.sh "Guelph, Ontario, Canada"
#   ./apps/local/scripts/generate-map-bg.sh --lat 43.55 --lng -80.25 "Guelph"
#   ./apps/local/scripts/generate-map-bg.sh --offset-lng -0.04 "Las Vegas"
#
# Options:
#   --lat <num>          Override latitude (skip geocoding)
#   --lng <num>          Override longitude (skip geocoding)
#   --offset-lat <num>   Shift center north/south (e.g., 0.02)
#   --offset-lng <num>   Shift center east/west (e.g., -0.04 = west)
#   --zoom <base>        Base zoom level (default: 11, generates base to base+3)
#   --opacity <num>      Default opacity percentage (default: 15)
#   --token <token>      Mapbox token (or set MAPBOX_TOKEN env var)
#   --apps <dir1,dir2>   Comma-separated app dirs (default: run.human,run.auth)
#   --dry-run            Show what would be done without downloading
#
# The script:
#   1. Geocodes the city name via Mapbox Geocoding API
#   2. Downloads 4 zoom levels of dark monochrome map tiles
#   3. Copies images to each app's public/bg/ directory
#   4. Prints a summary with the coordinates used

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Defaults
LAT=""
LNG=""
OFFSET_LAT=0
OFFSET_LNG=0
BASE_ZOOM=11
OPACITY=15
TOKEN=""
APPS="run.human,run.auth"
DRY_RUN=false
CITY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --lat)        LAT="$2"; shift 2 ;;
    --lng)        LNG="$2"; shift 2 ;;
    --offset-lat) OFFSET_LAT="$2"; shift 2 ;;
    --offset-lng) OFFSET_LNG="$2"; shift 2 ;;
    --zoom)       BASE_ZOOM="$2"; shift 2 ;;
    --opacity)    OPACITY="$2"; shift 2 ;;
    --token)      TOKEN="$2"; shift 2 ;;
    --apps)       APPS="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)            CITY="$1"; shift ;;
  esac
done

if [ -z "$CITY" ] && [ -z "$LAT" ]; then
  echo "Usage: $0 [options] \"City, State/Province, Country\""
  echo "Run with --help for full options."
  exit 1
fi

# Find Mapbox token
if [ -z "$TOKEN" ]; then
  TOKEN="${MAPBOX_TOKEN:-}"
fi
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/run.gpx/webapp/.env" ]; then
  TOKEN=$(grep "^MAPBOX_DEFAULT_TOKEN=" "$SCRIPT_DIR/run.gpx/webapp/.env" | cut -d'=' -f2)
fi
if [ -z "$TOKEN" ]; then
  echo "Error: No Mapbox token found."
  echo "Set MAPBOX_TOKEN env var, use --token, or ensure apps/run.gpx/webapp/.env exists."
  exit 1
fi

echo "=== Map Background Generator ==="
echo ""

# Geocode if lat/lng not provided
if [ -z "$LAT" ] || [ -z "$LNG" ]; then
  echo "Geocoding: $CITY"
  ENCODED_CITY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CITY'))")
  GEO_URL="https://api.mapbox.com/geocoding/v5/mapbox.places/${ENCODED_CITY}.json?access_token=${TOKEN}&limit=1"
  GEO_RESULT=$(curl -sL "$GEO_URL")

  # Extract coordinates [lng, lat] from first result
  LNG=$(echo "$GEO_RESULT" | python3 -c "import sys,json; f=json.load(sys.stdin)['features'][0]; print(f['center'][0])" 2>/dev/null)
  LAT=$(echo "$GEO_RESULT" | python3 -c "import sys,json; f=json.load(sys.stdin)['features'][0]; print(f['center'][1])" 2>/dev/null)
  PLACE_NAME=$(echo "$GEO_RESULT" | python3 -c "import sys,json; f=json.load(sys.stdin)['features'][0]; print(f['place_name'])" 2>/dev/null)

  if [ -z "$LAT" ] || [ -z "$LNG" ]; then
    echo "Error: Could not geocode '$CITY'. Try providing --lat and --lng manually."
    exit 1
  fi

  echo "Found: $PLACE_NAME"
  echo "Coordinates: $LAT, $LNG"
else
  echo "Using provided coordinates: $LAT, $LNG"
fi

# Apply offsets
CENTER_LNG=$(python3 -c "print(round($LNG + $OFFSET_LNG, 6))")
CENTER_LAT=$(python3 -c "print(round($LAT + $OFFSET_LAT, 6))")

if [ "$OFFSET_LNG" != "0" ] || [ "$OFFSET_LAT" != "0" ]; then
  echo "Offset applied: lat+${OFFSET_LAT}, lng+${OFFSET_LNG}"
  echo "Map center: $CENTER_LAT, $CENTER_LNG"
fi

echo ""

# Calculate zoom levels
Z1=$BASE_ZOOM
Z2=$((BASE_ZOOM + 1))
Z3=$((BASE_ZOOM + 2))
Z4=$((BASE_ZOOM + 3))

echo "Zoom levels: z${Z1} (far), z${Z2} (city), z${Z3} (streets), z${Z4} (close)"
echo "Default opacity: ${OPACITY}%"
echo "Target apps: $APPS"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "[dry-run] Would download 4 images and copy to app directories."
  exit 0
fi

# Download images
TMPDIR=$(mktemp -d)
STYLE="mapbox/dark-v11"

echo "Downloading map tiles..."
for z in $Z1 $Z2 $Z3 $Z4; do
  URL="https://api.mapbox.com/styles/v1/${STYLE}/static/${CENTER_LNG},${CENTER_LAT},${z},0/1280x1280?access_token=${TOKEN}&logo=false&attribution=false"
  curl -sL "$URL" -o "${TMPDIR}/vegas-z${z}.png" &
done
wait

# Verify downloads
for z in $Z1 $Z2 $Z3 $Z4; do
  FILE="${TMPDIR}/vegas-z${z}.png"
  SIZE=$(wc -c < "$FILE" | tr -d ' ')
  if [ "$SIZE" -lt 1000 ]; then
    echo "Error: Download failed for zoom $z ($(cat "$FILE"))"
    rm -rf "$TMPDIR"
    exit 1
  fi
done
echo "Downloaded 4 map tiles."

# Map downloaded zoom levels to the file names the component expects (z9-z12)
# Component uses: z9=far, z10=city, z11=streets, z12=close
echo ""
echo "Copying to app directories..."

IFS=',' read -ra APP_LIST <<< "$APPS"
for app in "${APP_LIST[@]}"; do
  APP_DIR="$SCRIPT_DIR/${app}/webapp/public/bg"
  mkdir -p "$APP_DIR"
  cp "${TMPDIR}/vegas-z${Z1}.png" "${APP_DIR}/vegas-z9.png"
  cp "${TMPDIR}/vegas-z${Z2}.png" "${APP_DIR}/vegas-z10.png"
  cp "${TMPDIR}/vegas-z${Z3}.png" "${APP_DIR}/vegas-z11.png"
  cp "${TMPDIR}/vegas-z${Z4}.png" "${APP_DIR}/vegas-z12.png"
  echo "  ${app}/webapp/public/bg/ (4 files)"
done

rm -rf "$TMPDIR"

echo ""
echo "=== Done ==="
echo ""
echo "City:       ${CITY:-custom}"
echo "Center:     ${CENTER_LAT}, ${CENTER_LNG}"
echo "Zoom range: z${Z1}-z${Z4}"
echo "Files:      vegas-z9.png (far) .. vegas-z12.png (close)"
echo ""
echo "To adjust the default opacity, edit map-background.tsx:"
echo "  opacity: ${OPACITY},"
