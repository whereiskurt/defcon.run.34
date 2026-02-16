#!/usr/bin/env bash
# orchestrate.sh — Main orchestrator for ConfigUI timelapse
set -uo pipefail

REPO_ROOT="/Users/khundeck/working/defcon.run.34"
OUTPUT_DIR="/tmp/configui-timelapse/frames"
LOG_DIR="/tmp/configui-timelapse/logs"
NUM_WORKERS=6
FRAME_DURATION=0.5

mkdir -p "$OUTPUT_DIR" "$LOG_DIR"

# All 77 configui commits in chronological order
COMMITS=(
  aa4f0f7
  726fcdf
  57ccfa4
  0f5d63a
  69c407f
  5e6c183
  48fc1df
  ea1b620
  a10e2a2
  4249e64
  83f2256
  b338efb
  e860166
  f40f1a4
  a173128
  bc83b5e
  9601c39
  ad6de06
  c1149a4
  89c5a0d
  e37c360
  67db8c7
  8e5cd49
  fe2d0e8
  9f53261
  f1e425a
  95913a8
  c6380b1
  cd8b49b
  fbdbfbe
  d340a78
  060a1ae
  a685185
  b87e431
  b3defc2
  9fa03fe
  522ac79
  ecefee0
  852ad48
  fb1dd6a
  8ebabf6
  8f7ff21
  2ff15b8
  ad3777d
  f28cca8
  6481b63
  05e8287
  69c35ca
  3e9bb8b
  69660c8
  745bc76
  4437a0e
  ef246f1
  e70d38e
  11249b3
  c5bbb00
  cefbf99
  68c1e62
  b5d3586
  d407183
  e949d00
  6b85a6b
  bfe9214
  f3d7ec0
  30af08e
  7a17dee
  831080b
  e707944
  795b603
  3b563e2
  0f798e4
  22c442b
  45e331f
  e0a9578
  6445eac
  856b7f0
  fad74ac
  5c67e48
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

  bash /tmp/configui-timelapse/worker.sh "$WT" "$OUTPUT_DIR" "$w" "${BATCH[@]}" &
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

# Build concat file for form frames (sorted by filename = chronological order)
FORM_CONCAT="/tmp/configui-timelapse/form-concat.txt"
PREVIEW_CONCAT="/tmp/configui-timelapse/preview-concat.txt"
> "$FORM_CONCAT"
> "$PREVIEW_CONCAT"

for f in $(ls "$OUTPUT_DIR"/*-form.png 2>/dev/null | sort); do
  echo "file '$f'" >> "$FORM_CONCAT"
  echo "duration $FRAME_DURATION" >> "$FORM_CONCAT"
done
# Add last frame again (held longer) for proper ending
LAST_FORM=$(ls "$OUTPUT_DIR"/*-form.png 2>/dev/null | sort | tail -1)
echo "file '$LAST_FORM'" >> "$FORM_CONCAT"
echo "duration 3.0" >> "$FORM_CONCAT"
echo "file '$LAST_FORM'" >> "$FORM_CONCAT"

for f in $(ls "$OUTPUT_DIR"/*-preview.png 2>/dev/null | sort); do
  echo "file '$f'" >> "$PREVIEW_CONCAT"
  echo "duration $FRAME_DURATION" >> "$PREVIEW_CONCAT"
done
LAST_PREVIEW=$(ls "$OUTPUT_DIR"/*-preview.png 2>/dev/null | sort | tail -1)
echo "file '$LAST_PREVIEW'" >> "$PREVIEW_CONCAT"
echo "duration 3.0" >> "$PREVIEW_CONCAT"
echo "file '$LAST_PREVIEW'" >> "$PREVIEW_CONCAT"

# GIF 1: Form evolution
echo "[orchestrate] Creating form evolution GIF..."
ffmpeg -y -f concat -safe 0 -i "$FORM_CONCAT" \
  -vf "scale=960:540:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  "/tmp/configui-timelapse/configui-form-evolution.gif" 2>/dev/null

# GIF 2: Preview evolution
echo "[orchestrate] Creating preview evolution GIF..."
ffmpeg -y -f concat -safe 0 -i "$PREVIEW_CONCAT" \
  -vf "scale=960:540:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  "/tmp/configui-timelapse/configui-preview-evolution.gif" 2>/dev/null

# MP4 1: Form evolution (better quality)
echo "[orchestrate] Creating form evolution MP4..."
ffmpeg -y -f concat -safe 0 -i "$FORM_CONCAT" \
  -vf "scale=1920:1080:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 \
  "/tmp/configui-timelapse/configui-form-evolution.mp4" 2>/dev/null

# MP4 2: Preview evolution (better quality)
echo "[orchestrate] Creating preview evolution MP4..."
ffmpeg -y -f concat -safe 0 -i "$PREVIEW_CONCAT" \
  -vf "scale=1920:1080:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 \
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
