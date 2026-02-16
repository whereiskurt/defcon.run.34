#!/usr/bin/env bash
# demo.sh — Capture animated feature demo GIFs for ConfigUI
# Usage: bash demo.sh [workflow_name]   (default: all workflows)
#
# Builds ConfigUI, starts a single server, runs Playwright workflows
# to capture numbered PNG frames, and stitches them into GIFs with ffmpeg.

set -uo pipefail

REPO_ROOT="/Users/khundeck/working/defcon.run.34"
CONFIGUI_DIR="$REPO_ROOT/apps/configui"
DOCS_DIR="$CONFIGUI_DIR/docs"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="/tmp/configui-demos"
BIN="/tmp/configui-demo-bin"
SERVER_LOG="/tmp/configui-demo-server.log"
DTS=$(date +%Y%m%d-%H%M%S)

FRAME_DURATION=0.8        # seconds per frame
LAST_FRAME_DURATION=2.0   # hold last frame longer
GIF_WIDTH=960
GIF_HEIGHT=540
GIF_COLORS=128

ALL_WORKFLOWS=(preview-toggle module-toggle panel-navigation pii-blur discovery-refresh plan-module)

# Which workflows to run
if [ $# -gt 0 ]; then
  WORKFLOWS=("$@")
else
  WORKFLOWS=("${ALL_WORKFLOWS[@]}")
fi

echo "[demo] ConfigUI Feature Demo Capture"
echo "[demo] Workflows: ${WORKFLOWS[*]}"
echo "[demo] Output: $DOCS_DIR/configui-demo-*-${DTS}.gif"
echo ""

# ─── Prerequisites Check ────────────────────────────────────────────────────────

for cmd in go node ffmpeg; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "[demo] ERROR: $cmd not found in PATH"
    exit 1
  fi
done

# Ensure Playwright is available
PW_DIR="/tmp/configui-timelapse"
if [ ! -d "$PW_DIR/node_modules/playwright" ]; then
  echo "[demo] Installing Playwright..."
  mkdir -p "$PW_DIR"
  cd "$PW_DIR" && npm install playwright 2>/dev/null
  npx playwright install chromium 2>/dev/null
fi

# ESM resolves from script file location — symlink node_modules into script dir
if [ ! -e "$SCRIPT_DIR/node_modules" ]; then
  ln -s "$PW_DIR/node_modules" "$SCRIPT_DIR/node_modules"
fi

# ─── Build ConfigUI ─────────────────────────────────────────────────────────────

echo "[demo] Building ConfigUI..."
cd "$CONFIGUI_DIR"
if ! go build -o "$BIN" . 2>/tmp/configui-demo-build.log; then
  echo "[demo] ERROR: Build failed"
  cat /tmp/configui-demo-build.log
  exit 1
fi
echo "[demo] Build OK"

# ─── Start Server ───────────────────────────────────────────────────────────────

> "$SERVER_LOG"
"$BIN" --no-browser > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "[demo] Cleaning up server (PID $SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server URL
URL=""
for i in $(seq 1 30); do
  sleep 0.3
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[demo] ERROR: Server exited prematurely"
    cat "$SERVER_LOG"
    exit 1
  fi
  URL=$(grep -o 'http://127\.0\.0\.1:[0-9]*' "$SERVER_LOG" 2>/dev/null | head -1 || true)
  if [ -n "$URL" ]; then
    if curl -s -o /dev/null -w '' "$URL" 2>/dev/null; then
      break
    fi
  fi
done

if [ -z "$URL" ]; then
  echo "[demo] ERROR: Could not get server URL"
  cat "$SERVER_LOG"
  exit 1
fi

echo "[demo] Server running at $URL (PID $SERVER_PID)"
echo ""

# ─── Run Workflows ──────────────────────────────────────────────────────────────

SUCCEEDED=0
FAILED=0

for WF in "${WORKFLOWS[@]}"; do
  FRAME_DIR="$DEMO_DIR/$WF"
  rm -rf "$FRAME_DIR"
  mkdir -p "$FRAME_DIR"

  echo "[demo] ── $WF ──────────────────────────"

  # Run Playwright capture
  if ! node "$SCRIPT_DIR/demo-capture.mjs" "$URL" "$WF" "$FRAME_DIR" 2>&1; then
    echo "[demo] ERROR: Workflow '$WF' failed"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Count frames
  FRAME_COUNT=$(ls "$FRAME_DIR"/*.png 2>/dev/null | grep -v error | wc -l | tr -d ' ')
  if [ "$FRAME_COUNT" -eq 0 ]; then
    echo "[demo] ERROR: No frames captured for '$WF'"
    FAILED=$((FAILED + 1))
    continue
  fi

  echo "[demo] Captured $FRAME_COUNT frames"

  # ─── Stitch with ffmpeg ──────────────────────────────────────────────────────
  CONCAT="$DEMO_DIR/${WF}-concat.txt"
  > "$CONCAT"

  SORTED_FRAMES=($(ls "$FRAME_DIR"/*.png 2>/dev/null | grep -v error | sort))
  LAST_IDX=$(( ${#SORTED_FRAMES[@]} - 1 ))

  for idx in "${!SORTED_FRAMES[@]}"; do
    f="${SORTED_FRAMES[$idx]}"
    echo "file '$f'" >> "$CONCAT"
    if [ "$idx" -eq "$LAST_IDX" ]; then
      echo "duration $LAST_FRAME_DURATION" >> "$CONCAT"
    else
      echo "duration $FRAME_DURATION" >> "$CONCAT"
    fi
  done
  # ffmpeg concat requires the last file repeated
  echo "file '${SORTED_FRAMES[$LAST_IDX]}'" >> "$CONCAT"

  GIF_OUT="$DOCS_DIR/configui-demo-${WF}-${DTS}.gif"

  echo "[demo] Generating GIF..."
  if ffmpeg -y -f concat -safe 0 -i "$CONCAT" \
    -vf "scale=${GIF_WIDTH}:${GIF_HEIGHT}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${GIF_COLORS}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
    "$GIF_OUT" 2>/dev/null; then
    GIF_SIZE=$(ls -lh "$GIF_OUT" | awk '{print $5}')
    echo "[demo] GIF: $GIF_OUT ($GIF_SIZE)"
    SUCCEEDED=$((SUCCEEDED + 1))
  else
    echo "[demo] ERROR: ffmpeg failed for '$WF'"
    FAILED=$((FAILED + 1))
  fi

  echo ""
done

# ─── Summary ────────────────────────────────────────────────────────────────────

echo "[demo] ══════════════════════════════════════"
echo "[demo] Done: $SUCCEEDED succeeded, $FAILED failed"
echo "[demo] Frames preserved in: $DEMO_DIR/"
echo "[demo] GIFs in: $DOCS_DIR/"
ls -lh "$DOCS_DIR"/configui-demo-*-${DTS}.gif 2>/dev/null || echo "[demo] (no GIFs produced)"
