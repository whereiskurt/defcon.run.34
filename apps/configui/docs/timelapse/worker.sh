#!/usr/bin/env bash
# worker.sh — Process a batch of commits in a git worktree
# Usage: worker.sh <worktree_path> <output_dir> <worker_id> <total_commits> <commit1> <commit2> ...

set -uo pipefail

WORKTREE="$1"
OUTPUT_DIR="$2"
WORKER_ID="$3"
TOTAL_COMMITS="$4"
shift 4
COMMITS=("$@")

LOG="/tmp/configui-timelapse/logs/worker-${WORKER_ID}.log"
exec > >(tee -a "$LOG") 2>&1

echo "[worker-${WORKER_ID}] Starting with ${#COMMITS[@]} commits in $WORKTREE"

SCREENSHOT_SCRIPT="$(cd "$(dirname "$0")" && pwd)/screenshot.mjs"
# Fallback: if running from /tmp copy, use the committed path
if [ ! -f "$SCREENSHOT_SCRIPT" ]; then
  SCREENSHOT_SCRIPT="/Users/khundeck/working/defcon.run.34/apps/configui/docs/timelapse/screenshot.mjs"
fi

IDX=0
for COMMIT in "${COMMITS[@]}"; do
  SHORT="${COMMIT:0:7}"
  MSG=$(cd "$WORKTREE" && git log --format="%s" -1 "$COMMIT" 2>/dev/null || echo "unknown")
  echo "[worker-${WORKER_ID}] Processing $SHORT: $MSG"

  # Checkout commit in worktree (detached HEAD)
  cd "$WORKTREE"
  git checkout --force "$COMMIT" 2>/dev/null || {
    echo "[worker-${WORKER_ID}] $SHORT: checkout failed, skipping"
    continue
  }
  git clean -fd 2>/dev/null || true

  # Copy gitignored config files needed for AWS connectivity
  REPO_ROOT="/Users/khundeck/working/defcon.run.34"
  cp "$REPO_ROOT/env.local.sh" "$WORKTREE/env.local.sh" 2>/dev/null || true
  mkdir -p "$WORKTREE/apps/configui" 2>/dev/null || true
  cp "$REPO_ROOT/apps/configui/site-config.json" "$WORKTREE/apps/configui/site-config.json" 2>/dev/null || true

  # Build configui
  CONFIGUI_DIR="$WORKTREE/apps/configui"
  if [ ! -d "$CONFIGUI_DIR" ]; then
    echo "[worker-${WORKER_ID}] $SHORT: apps/configui not found, skipping"
    continue
  fi

  BIN="/tmp/configui-bin-${WORKER_ID}"
  cd "$CONFIGUI_DIR"
  if ! go build -o "$BIN" . 2>/tmp/configui-timelapse/logs/build-${WORKER_ID}-${SHORT}.log; then
    echo "[worker-${WORKER_ID}] $SHORT: build failed, skipping"
    cat /tmp/configui-timelapse/logs/build-${WORKER_ID}-${SHORT}.log
    continue
  fi

  # Start configui server with --no-browser
  "$BIN" --no-browser > /tmp/configui-timelapse/logs/server-${WORKER_ID}.log 2>&1 &
  SERVER_PID=$!

  # Wait for server to be ready (poll for URL in output)
  URL=""
  for i in $(seq 1 30); do
    sleep 0.3
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "[worker-${WORKER_ID}] $SHORT: server exited prematurely"
      break
    fi
    URL=$(grep -o 'http://127\.0\.0\.1:[0-9]*' /tmp/configui-timelapse/logs/server-${WORKER_ID}.log 2>/dev/null | head -1 || true)
    if [ -n "$URL" ]; then
      if curl -s -o /dev/null -w '' "$URL" 2>/dev/null; then
        break
      fi
    fi
  done

  if [ -z "$URL" ]; then
    echo "[worker-${WORKER_ID}] $SHORT: could not get server URL, skipping"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    continue
  fi

  echo "[worker-${WORKER_ID}] $SHORT: server at $URL"

  # Get global sequence number for correct frame ordering
  SEQ_FILE="/tmp/configui-timelapse/seq-${SHORT}"
  GLOBAL_IDX=$(cat "$SEQ_FILE" 2>/dev/null || echo "999")
  PADDED=$(printf "%03d" "$GLOBAL_IDX")
  PREFIX="${OUTPUT_DIR}/${PADDED}-${SHORT}"

  # Frame number is 1-based for display
  FRAME_NUM=$((GLOBAL_IDX + 1))

  node "$SCREENSHOT_SCRIPT" "$URL" "$PREFIX" "$COMMIT" "$MSG" "$FRAME_NUM" "$TOTAL_COMMITS" || {
    echo "[worker-${WORKER_ID}] $SHORT: screenshot failed"
  }

  # Kill server
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  > /tmp/configui-timelapse/logs/server-${WORKER_ID}.log

  IDX=$((IDX + 1))
  echo "[worker-${WORKER_ID}] $SHORT: done ($IDX/${#COMMITS[@]})"
done

echo "[worker-${WORKER_ID}] All done."
