#!/usr/bin/env bash
# orchestrate.sh — Main orchestrator for ConfigUI timelapse
set -uo pipefail

REPO_ROOT="/Users/khundeck/working/defcon.run.34"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="/tmp/configui-timelapse/frames"
LOG_DIR="/tmp/configui-timelapse/logs"
NUM_WORKERS=6
FRAME_DURATION=0.35

mkdir -p "$OUTPUT_DIR" "$LOG_DIR"

# Ensure Playwright is installed for screenshot.mjs
PW_DIR="/tmp/configui-timelapse"
if [ ! -d "$PW_DIR/node_modules/playwright" ]; then
  echo "[orchestrate] Installing Playwright..."
  cd "$PW_DIR" && npm install playwright 2>/dev/null
  npx playwright install chromium 2>/dev/null
fi
# ESM resolves from script file location — symlink node_modules into script dir
if [ ! -e "$SCRIPT_DIR/node_modules" ]; then
  ln -s "$PW_DIR/node_modules" "$SCRIPT_DIR/node_modules" 2>/dev/null || true
fi

# All configui commits in chronological order (218 total)
COMMITS=(
  # Original 115 commits (aa4f0f7 through 2f15a1d)
  aa4f0f7 726fcdf 57ccfa4 0f5d63a 69c407f 5e6c183 48fc1df ea1b620 a10e2a2 4249e64
  83f2256 b338efb e860166 f40f1a4 a173128 bc83b5e 9601c39 ad6de06 c1149a4 89c5a0d
  e37c360 67db8c7 8e5cd49 fe2d0e8 9f53261 f1e425a 95913a8 c6380b1 cd8b49b fbdbfbe
  d340a78 060a1ae a685185 b87e431 b3defc2 9fa03fe 522ac79 ecefee0 852ad48 fb1dd6a
  8ebabf6 8f7ff21 2ff15b8 ad3777d f28cca8 6481b63 05e8287 69c35ca 3e9bb8b 69660c8
  745bc76 4437a0e ef246f1 e70d38e 11249b3 c5bbb00 cefbf99 68c1e62 b5d3586 d407183
  e949d00 6b85a6b bfe9214 f3d7ec0 30af08e 7a17dee 831080b e707944 795b603 3b563e2
  0f798e4 22c442b 45e331f e0a9578 6445eac 856b7f0 fad74ac 5c67e48 6a77630 41e61fe
  c83c51e 492c735 b8f6081 060285c 60131e5 040285c 01868db dfcb411 a28c021 4b9a47b
  ab9ed88 fe3ee33 23e3f32 bdcf6be 8dc0de8 85173e8 08c67e5 4fb4e5a 3a3f8c1 084018b
  fb602fb 6181da9 80c3b43 3efbafd abc79fe d9daaec 870ab58 0421253 1d678ca f78a1a7
  837012a 12529de dd14d26 2f15a1d
  # 104 new commits (a7f2220 through 4f09b9a)
  a7f2220 48511d6 dfbd884 6cf456b 5c61a8b 3d68a7f ed3bb83 465c6ca cc0ba0e 2266b35
  a2d3148 95fa9f4 b96a287 4e42e09 d92eb20 1418ab0 92fa595 c04273c 4a28296 d00deed
  0ca9358 3e2328a 5f719b5 983e357 98fc6af 6108287 41e870c 104a609 550b298 b97e91a
  64097e4 bad5810 a37eda4 990511d 0083235 34c2fa3 b42e60b 4b19f5b 64ade61 3c10354
  4d86af5 a428657 9347bb3 e296b4c 9ccf4d6 f8116c4 003601d 9a213c8 4bdfc78 3e3923c
  f71fb98 7753f53 2f2ce22 ce40ea0 ffe5d64 0ec6e1a 92eea2d c8933d7 dde945f f3ef042
  53d226a 7b6bc80 e8ccb3b bfe4d26 9a2015d a33b8c0 7a0fe2e e6f8258 eda0b82 6dc0df7
  ec06734 caadf99 32b07c6 f4ebb35 e32666c 1af4088 51e788a 970be75 cfc8d34 4b1202f
  832d3cb 48e8967 d64e5ca 8945a4f 6978cf7 ac0b7e7 faafbfb 1b1e600 1484a6c 76436be
  64a9e98 15c6047 ca67bfd ba49a38 cd91217 ce396d4 aff3231 f49551a ec77eff 616820a
  3ad9896 4340104 d706f2d 4f09b9a
)

TOTAL=${#COMMITS[@]}
echo "[orchestrate] $TOTAL commits to process with $NUM_WORKERS workers at ${FRAME_DURATION}s/frame"

# Write sequence number files for each commit (for correct frame ordering)
for i in "${!COMMITS[@]}"; do
  echo "$i" > "/tmp/configui-timelapse/seq-${COMMITS[$i]:0:7}"
done

# Create worktrees
for w in $(seq 1 $NUM_WORKERS); do
  WT="/tmp/configui-wt${w}"
  if [ -d "$WT" ]; then
    echo "[orchestrate] Removing existing worktree $WT"
    cd "$REPO_ROOT" && git worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
  fi
  echo "[orchestrate] Creating worktree $WT"
  cd "$REPO_ROOT" && git worktree add --detach "$WT" HEAD 2>/dev/null
done

# Divide commits into batches
BATCH_SIZE=$(( (TOTAL + NUM_WORKERS - 1) / NUM_WORKERS ))
echo "[orchestrate] Batch size: ~$BATCH_SIZE commits per worker"

PIDS=()
for w in $(seq 1 $NUM_WORKERS); do
  START=$(( (w - 1) * BATCH_SIZE ))
  BATCH=()
  for i in $(seq $START $(( START + BATCH_SIZE - 1 ))); do
    if [ $i -lt $TOTAL ]; then
      BATCH+=("${COMMITS[$i]}")
    fi
  done

  if [ ${#BATCH[@]} -eq 0 ]; then
    echo "[orchestrate] Worker $w: no commits, skipping"
    continue
  fi

  WT="/tmp/configui-wt${w}"
  LAST_IDX=$(( ${#BATCH[@]} - 1 ))
  echo "[orchestrate] Worker $w: ${#BATCH[@]} commits (${BATCH[0]}..${BATCH[$LAST_IDX]})"

  bash "$SCRIPT_DIR/worker.sh" "$WT" "$OUTPUT_DIR" "$w" "$TOTAL" "${BATCH[@]}" &
  PIDS+=($!)
done

echo "[orchestrate] All workers launched, waiting..."

# Wait for all workers
FAIL=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    echo "[orchestrate] Worker PID $pid failed"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 1 ]; then
  echo "[orchestrate] WARNING: Some workers failed, continuing with available frames"
fi

# Count frames
FORM_COUNT=$(ls "$OUTPUT_DIR"/*-form.png 2>/dev/null | wc -l | tr -d ' ')
PREVIEW_COUNT=$(ls "$OUTPUT_DIR"/*-preview.png 2>/dev/null | wc -l | tr -d ' ')
echo "[orchestrate] Frames captured: $FORM_COUNT form, $PREVIEW_COUNT preview"

if [ "$FORM_COUNT" -eq 0 ]; then
  echo "[orchestrate] ERROR: No frames captured!"
  exit 1
fi

# Generate GIFs and MP4s with ffmpeg
echo "[orchestrate] Generating GIF and MP4 outputs..."

# Build concat files (MUST use numeric sort for 3-digit prefixes)
FORM_CONCAT="/tmp/configui-timelapse/form-concat.txt"
PREVIEW_CONCAT="/tmp/configui-timelapse/preview-concat.txt"
> "$FORM_CONCAT"
> "$PREVIEW_CONCAT"

for f in $(ls "$OUTPUT_DIR"/*-form.png 2>/dev/null | sort -t- -k1 -n); do
  echo "file '$f'" >> "$FORM_CONCAT"
  echo "duration $FRAME_DURATION" >> "$FORM_CONCAT"
done
# Hold last frame longer
LAST_FORM=$(ls "$OUTPUT_DIR"/*-form.png 2>/dev/null | sort -t- -k1 -n | tail -1)
echo "file '$LAST_FORM'" >> "$FORM_CONCAT"
echo "duration 3.0" >> "$FORM_CONCAT"
echo "file '$LAST_FORM'" >> "$FORM_CONCAT"

for f in $(ls "$OUTPUT_DIR"/*-preview.png 2>/dev/null | sort -t- -k1 -n); do
  echo "file '$f'" >> "$PREVIEW_CONCAT"
  echo "duration $FRAME_DURATION" >> "$PREVIEW_CONCAT"
done
LAST_PREVIEW=$(ls "$OUTPUT_DIR"/*-preview.png 2>/dev/null | sort -t- -k1 -n | tail -1)
echo "file '$LAST_PREVIEW'" >> "$PREVIEW_CONCAT"
echo "duration 3.0" >> "$PREVIEW_CONCAT"
echo "file '$LAST_PREVIEW'" >> "$PREVIEW_CONCAT"

# GIF: 960x540, 256 colors, full stats mode (better palette for overlay text)
GIF_VF="scale=960:540:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=2"

echo "[orchestrate] Creating form evolution GIF..."
ffmpeg -y -f concat -safe 0 -i "$FORM_CONCAT" \
  -vf "$GIF_VF" \
  "/tmp/configui-timelapse/configui-form-evolution.gif" 2>/dev/null

echo "[orchestrate] Creating preview evolution GIF..."
ffmpeg -y -f concat -safe 0 -i "$PREVIEW_CONCAT" \
  -vf "$GIF_VF" \
  "/tmp/configui-timelapse/configui-preview-evolution.gif" 2>/dev/null

# MP4: full 1920x1080, high quality
echo "[orchestrate] Creating form evolution MP4..."
ffmpeg -y -f concat -safe 0 -i "$FORM_CONCAT" \
  -vf "scale=1920:1080:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 \
  "/tmp/configui-timelapse/configui-form-evolution.mp4" 2>/dev/null

echo "[orchestrate] Creating preview evolution MP4..."
ffmpeg -y -f concat -safe 0 -i "$PREVIEW_CONCAT" \
  -vf "scale=1920:1080:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 \
  "/tmp/configui-timelapse/configui-preview-evolution.mp4" 2>/dev/null

echo "[orchestrate] Output files:"
ls -lh /tmp/configui-timelapse/configui-*

# Cleanup worktrees
echo "[orchestrate] Cleaning up worktrees..."
cd "$REPO_ROOT"
for w in $(seq 1 $NUM_WORKERS); do
  WT="/tmp/configui-wt${w}"
  git worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
done

echo "[orchestrate] DONE!"
