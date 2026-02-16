# ConfigUI Timelapse Generator

Automated pipeline that builds, runs, and screenshots a Go web app at every git commit to produce an animated GIF/MP4 showing visual evolution over time.

## Last Run

| Field | Value |
|-------|-------|
| **Date** | 2026-02-15 |
| **Last commit included** | `4b9a47b` — Add timelapse pipeline docs and scripts for ConfigUI visual evolution |
| **Total frames** | 81 (of 89 commits; 8 timed out on early commits without AWS status bar) |
| **Frame numbering** | `00` through `88` (gaps where timeouts occurred) |
| **Output files** | `configui-{form,preview}-evolution-20260215-200131.{gif,mp4}` |
| **Existing frames cached at** | `/tmp/configui-timelapse/frames/` (survives until reboot) |

## Overview

The pipeline uses **parallel git worktrees** to process multiple commits simultaneously. Each worktree checks out a commit, builds the Go binary, starts the server, waits for AWS connectivity, takes Playwright screenshots, and kills the server. An orchestrator divides commits across workers and ffmpeg stitches the frames into GIF/MP4.

```
orchestrate.sh
  ├── Creates N git worktrees
  ├── Divides commits into N batches
  ├── Launches N worker.sh processes in parallel
  │     └── For each commit:
  │           1. git checkout
  │           2. go build
  │           3. Start server, capture random port
  │           4. node screenshot.mjs (Playwright)
  │           5. Kill server
  └── ffmpeg: frames → GIF + MP4
```

## Prerequisites

- **Go** (any version >= 1.22)
- **Node.js** (>= 18) with Playwright: `npm install playwright`
- **Chromium** for Playwright: `npx playwright install chromium`
- **ffmpeg** (for GIF/MP4 generation)
- **git** (for worktrees)
- **AWS SSO session** (optional, for "AWS Connected" status in screenshots)

## Files

| File | Purpose |
|------|---------|
| `orchestrate.sh` | Main entry point. Creates worktrees, divides work, launches workers, runs ffmpeg. |
| `worker.sh` | Processes one batch of commits sequentially in a single worktree. |
| `screenshot.mjs` | Playwright ESM script. Navigates to URL, waits for AWS status, takes form + preview screenshots. |

## Dry Run

Before running anything, here's what the pipeline *would* do — no files created, no processes launched.

```
$ bash orchestrate.sh --dry-run    # (conceptual, not implemented as a flag)

1. DISCOVER COMMITS
   Find all configui commits since last run (4b9a47b):
     git log --oneline --reverse 4b9a47b..HEAD -- apps/configui/
   → 8 new commits found (6a77630..01868db)
   Combined with 78 existing: 86 total commits to include.

2. CHECK CACHED FRAMES
   Look in /tmp/configui-timelapse/frames/ for existing PNGs.
   → Found: 70 frames (00-aa4f0f7 through 77-4b9a47b), 8 gaps from timeouts.
   → Need: 8 new frames (78-6a77630 through 85-01868db).
   Existing frames will NOT be re-rendered.

3. CREATE WORKTREES
   Create 6 temporary git worktrees in /tmp/configui-wt{1..6}.
   Each is a full independent checkout (~200MB each, ~1.2GB total).
   These are throwaway copies — your real repo is untouched.

4. DIVIDE WORK
   8 new commits ÷ 6 workers = 2 commits per worker (some get 1).
   Workers run in parallel, each processing its batch sequentially.

5. PER COMMIT (× 8 new commits, ~12s each):
   a. git checkout <commit> in the worktree
   b. Copy env.local.sh + site-config.json into worktree (for AWS creds)
   c. go build -o /tmp/configui-bin-{N} apps/configui/
   d. Start ./configui-bin --no-browser (binds random port on 127.0.0.1)
   e. Poll server log until URL appears (e.g. http://127.0.0.1:54321)
   f. Launch headless Chromium (1920×1080 viewport)
   g. Navigate to URL, wait for page load + AWS status to resolve (~5-12s)
   h. Inject commit hash overlay at bottom of page
   i. Screenshot 1: form view → /tmp/.../frames/78-6a77630-form.png
   j. Click "Preview" button (tries multiple selectors)
   k. Wait 1.5s for preview panel to render
   l. Screenshot 2: with preview → /tmp/.../frames/78-6a77630-preview.png
   m. Kill configui server, move to next commit

6. STITCH WITH FFMPEG (~5s)
   Sort ALL frame PNGs (old + new) by filename → chronological order.
   Generate 4 output files:
   - configui-form-evolution.gif     (960×540, 128 colors, 0.5s/frame)
   - configui-preview-evolution.gif  (960×540, 128 colors, 0.5s/frame)
   - configui-form-evolution.mp4     (1920×1080, h264, 0.5s/frame)
   - configui-preview-evolution.mp4  (1920×1080, h264, 0.5s/frame)
   Last frame held for 3s. Total duration: ~46s for 86 frames.

7. CLEANUP
   Remove all 6 worktrees from /tmp/.
   Frames stay cached for future incremental runs.

8. COPY TO DOCS
   Copy outputs to apps/configui/docs/ with DTS suffix.
   Update README.md hero GIF reference.

ESTIMATED TIME: ~30s (8 new commits across 6 workers + ffmpeg)
DISK USAGE: ~1.5GB temporary (worktrees + frames), 4MB final outputs
```

### What could go wrong

- **AWS SSO expired** → Screenshots show "Not Connected" instead of green status. Fix: `aws sso login --sso-session Developer`
- **Frames lost (reboot)** → Must re-render all 86 commits (~5 min). The pipeline handles this automatically — it just takes longer.
- **Commit doesn't build** → Worker skips it and moves to next. Gap in frame numbering. ffmpeg ignores gaps.
- **Preview button missing** → Form screenshot is copied as the preview frame. No error.
- **Server won't start** → Worker waits 9s, gives up, skips. Logged in `/tmp/configui-timelapse/logs/`.

## Quick Re-run

```bash
# From repo root
cd apps/configui/docs/timelapse
npm install playwright  # if not already installed

# Edit orchestrate.sh to update:
#   - REPO_ROOT (absolute path to your repo)
#   - COMMITS array (add/remove commits)
#   - NUM_WORKERS (default 6)
#   - FRAME_DURATION (default 0.5s)

bash orchestrate.sh
# Output: /tmp/configui-timelapse/configui-{form,preview}-evolution.{gif,mp4}
```

## Architecture Decisions

### Why git worktrees?

Each commit needs a full checkout to build the Go binary. Worktrees let us have N independent checkouts from the same repo without cloning. Workers run in parallel — 6 workers process 78 commits in ~5 minutes vs ~30 minutes sequential.

### Why not just `git stash`/`checkout` in the main repo?

The main repo stays untouched. Worktrees are created in `/tmp/` and cleaned up after. No risk of corrupting the working tree.

### Random port binding

ConfigUI binds to `127.0.0.1:0` (OS-assigned random port). The port is extracted from server log output:

```bash
URL=$(grep -o 'http://127\.0\.0\.1:[0-9]*' server.log | head -1)
```

The log format varies across commits:
- Early: `ConfigUI running at http://127.0.0.1:PORT`
- Later: `% ./ConfigUI_ running at http://127.0.0.1:PORT`

The regex `http://127\.0\.0\.1:[0-9]*` matches both.

### AWS connectivity

ConfigUI calls `aws sts get-caller-identity --profile dc34-terraform` on page load via an HTMX endpoint (`/api/aws-status`). For screenshots to show "AWS Connected":

1. The SSO session must be active (`aws sso login --sso-session Developer`)
2. `env.local.sh` must exist at the worktree root (contains profile prefix)
3. `site-config.json` must exist at `apps/configui/` (contains saved form state)

Both files are gitignored, so `worker.sh` copies them from the real repo into each worktree before starting the server.

The screenshot script waits up to 12 seconds for the AWS status div to resolve before capturing. Early commits without an AWS status bar skip immediately.

### Commit overlay

Playwright injects a fixed-position div at the bottom of the viewport with the commit hash (amber) and message (green) on a dark background. This is done via `page.evaluate()` before each screenshot — no ffmpeg post-processing needed.

### Two screenshot types

1. **Form view** — page as loaded (panels collapsed in later commits)
2. **Preview view** — after clicking the Preview button to open the HCL side panel

The Preview button text varies: "Preview", "Preview To Save", or lowercase "preview". The script tries multiple selectors in order. If no button is found, it copies the form screenshot as a fallback.

## Key Gotchas

### macOS bash 3.2

macOS ships bash 3.2 which doesn't support negative array indexing (`${arr[-1]}`). Use `${arr[${#arr[@]}-1]}` instead.

### Playwright module resolution

Playwright must be installed in the working directory where `node screenshot.mjs` runs, or globally. The script uses ESM imports (`import { chromium } from 'playwright'`). Install with `npm install playwright` in the script's directory.

### `go build` across commits

Since ConfigUI has zero external dependencies (stdlib only), `go build` works reliably at every commit with any modern Go version. If the app had external deps, you'd need `go mod download` and potentially version-pinned Go.

### Server startup race

The worker polls for the URL in the server log with a 0.3s sleep loop (up to 30 iterations = 9 seconds). It also verifies the server responds to curl before proceeding. This handles both slow builds and slow server startup.

### Worktree cleanup

`git worktree remove --force` cleans up after each run. If the script crashes, orphaned worktrees can be cleaned with:

```bash
for w in 1 2 3 4 5 6; do
  git worktree remove --force /tmp/configui-wt${w} 2>/dev/null
done
git worktree prune
```

## Adding More Frames (Incremental Update)

Yes — you can add frames without re-rendering everything. The pipeline produces numbered PNGs (`00-aa4f0f7-form.png`, `01-726fcdf-form.png`, ...) and only the ffmpeg stitching step needs all frames present. The expensive part (build + screenshot) can target just the new commits.

### Step-by-step

```bash
# 1. Check what's new since last run
git log --oneline --reverse 4b9a47b..HEAD -- apps/configui/
#   6a77630 Remove infra module subtitles...
#   41e61fe Add confirmation dialogs...
#   ...etc

# 2. Make sure old frames still exist (or re-screenshot missing ones)
ls /tmp/configui-timelapse/frames/ | head -5

# 3. Only screenshot the new commits:
#    - Create a small orchestrate-incremental.sh (or edit COMMITS array)
#    - Set starting sequence number = next after last frame
#    - Run just the new commits through the worker pipeline

# 4. Re-stitch ALL frames (old + new) with ffmpeg
#    The orchestrate.sh ffmpeg section just reads sorted PNGs from frames/
#    Re-running that section alone takes ~5 seconds
```

### What's reusable vs what must re-run

| Step | Time | Reusable? |
|------|------|-----------|
| Build + screenshot per commit | ~8s each | Cached as PNGs in `/tmp/configui-timelapse/frames/` |
| ffmpeg GIF generation | ~3s | Must re-run with all frames |
| ffmpeg MP4 generation | ~2s | Must re-run with all frames |

### Quick incremental script

```bash
#!/usr/bin/env bash
# incremental.sh — Add new commits to existing timelapse
# Usage: bash incremental.sh <commit1> <commit2> ...

REPO_ROOT="/Users/khundeck/working/defcon.run.34"
OUTPUT_DIR="/tmp/configui-timelapse/frames"
SCRIPTS="/Users/khundeck/working/defcon.run.34/apps/configui/docs/timelapse"

# Find the next sequence number from existing frames
LAST_SEQ=$(ls "$OUTPUT_DIR"/*-form.png 2>/dev/null | sort | tail -1 | sed 's|.*/\([0-9]*\)-.*|\1|')
NEXT_SEQ=$((10#$LAST_SEQ + 1))

# Create a single worktree for the new commits
WT="/tmp/configui-wt-incr"
cd "$REPO_ROOT" && git worktree remove --force "$WT" 2>/dev/null
git worktree add --detach "$WT" HEAD

IDX=$NEXT_SEQ
for COMMIT in "$@"; do
  echo "$IDX" > "/tmp/configui-timelapse/seq-${COMMIT:0:7}"
  IDX=$((IDX + 1))
done

# Run worker with new commits
bash "$SCRIPTS/worker.sh" "$WT" "$OUTPUT_DIR" "incr" "$@"

# Cleanup worktree
cd "$REPO_ROOT" && git worktree remove --force "$WT"

# Re-stitch (just the ffmpeg part from orchestrate.sh)
echo "Re-stitching all frames..."
FRAME_DURATION=0.5
# ... (copy the ffmpeg section from orchestrate.sh)
echo "Done! Run the ffmpeg section from orchestrate.sh to regenerate GIFs."
```

Or simply: update the `COMMITS` array in `orchestrate.sh`, keep the old frames in `/tmp/configui-timelapse/frames/`, and modify the worker to skip commits whose frame PNGs already exist.

## Customization

### Changing frame rate

Edit `FRAME_DURATION` in `orchestrate.sh`:
- `0.5` — fast (current, ~40s for 78 frames)
- `1.0` — moderate (~80s)
- `1.5` — slow, readable (~2 min)

The last frame is held for 3 seconds regardless.

### Selecting commits

Replace the `COMMITS=()` array in `orchestrate.sh`. Get all commits for a path with:

```bash
git log --oneline --reverse -- apps/configui/
```

Or pick milestones manually for a curated progression.

### GIF quality/size

The ffmpeg palette generation uses 128 colors with Bayer dithering at half resolution (960x540). Adjust in orchestrate.sh:
- `max_colors=256` — better quality, larger file
- `scale=1280:720` — higher res, larger file
- `stats_mode=full` — better for static content (vs `diff` for animation)

### Adding to other apps

This pattern works for any web app that:
1. Can be built from source at each commit
2. Starts a local HTTP server
3. Has a deterministic URL (or logs it)

Replace the Go build step with whatever your app needs (`npm run build`, `cargo build`, etc.).

## Skill Candidate

This is a good candidate for a reusable Claude Code skill:

**Trigger**: `/timelapse` or `/visual-evolution`

**Inputs**:
- App path (e.g., `apps/configui`)
- Build command (e.g., `go build -o /tmp/bin .`)
- Start command (e.g., `./bin --no-browser`)
- Port detection pattern (regex for server log)
- Commit range or path filter
- Frame rate
- Screenshot actions (buttons to click, waits)
- Files to copy into worktree (gitignored configs)

**Outputs**:
- `{app}-form-evolution-{DTS}.gif`
- `{app}-preview-evolution-{DTS}.gif`
- `{app}-form-evolution-{DTS}.mp4`
- `{app}-preview-evolution-{DTS}.mp4`

The skill would generate the three scripts dynamically based on inputs, execute the pipeline, and copy results to the app's docs folder.
