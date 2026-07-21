# run.gpx — Scheduled background Strava sync (10AM/10PM) + "Sync now"

**Date:** 2026-07-21
**Status:** Approved direction (Kurt, 2026-07-21 AM). Builds ON TOP of the Strava strip
(PR #869) — implementation starts after that merges.
**Depends on:** `docs/superpowers/specs/2026-07-21-gpx-strava-strip-design.md`

## Summary

Every linked runner gets their last-7-days Strava activities imported automatically
twice a day (10:00 and 22:00 America/Los_Angeles), plus a user-facing **"Sync now"**
button (limit ~2/day). Background and manual syncs import **untagged** (no `conDay`,
matching the existing batch semantics); runners assign days afterwards via the strip
popover or the Save-as-defcon.run-Activity dialog — the 10/con-day cap applies at
tagging time, not import time.

## Decisions (Kurt, 2026-07-21)

| Decision | Choice |
|---|---|
| Background sync behavior | Auto-import all fresh last-7-days activities per user, UNTAGGED (existing batch semantics: no conDay, no user quota) |
| Schedule | 10:00 + 22:00, `America/Los_Angeles`, daily |
| "Sync now" | Button in the strip header; runs the same untagged per-user sync + refreshes the strip; ~2/day |
| Scope | Follow-up PR after #869 merges (this branch) |

## Design

### 1. Scheduler (infra)

- Instantiate the existing DRAFT module `infra/terraform/modules/strava-sync-scheduler/v1.0.0`
  (Phase 33 — built, never deployed) in live, targeting the existing secret-guarded
  `POST /api/gpx/internal/strava-sync`.
- Two EventBridge Scheduler schedules on the one module instance (or two instances):
  `cron(0 10 * * ? *)` and `cron(0 22 * * ? *)` with `schedule_expression_timezone =
  "America/Los_Angeles"`. Check the module's current single-expression variable —
  extend to a list or instantiate twice, whichever is smaller.
- Deploy via the normal worktree flow (build local, deploy via deploy.yml CI).

### 2. Rolling 7-day window (batch path)

- `bandBounds()` in `webapp/src/lib/strava-sync.ts` currently reads static
  `STRAVA_SYNC_AFTER`/`BEFORE` envs. Change: the internal route accepts an optional
  `{ afterDays?: number }` body; the scheduler Lambda invoker sends `{ afterDays: 7 }`.
  Explicit env band still wins when set (back-compat for one-off backfills).
- Batch importer stays untagged + user-quota-free (existing Phase-31b semantics).
- Strava app-wide rate limits (200/15min, 2000/day): existing 429 skip-and-retry-next-
  cycle behavior is the guardrail; with 2 runs/day it has 12h to catch up. Watch the
  locked `strava.ratelimit` CloudWatch widget after enabling.

### 3. "Sync now" (per-user, untagged)

- New `POST /api/gpx/strava/sync-now` (session-authenticated, same guard stack as the
  strip routes). Runs the untagged import for the SESSION user only, rolling last-7-days
  window, dedupe by `stravaActivityId` — i.e. per-user equivalent of what the batch job
  does for everyone. Returns `{ imported, skipped, remainingToday }`.
- **Daily limit (2/day, con-local midnight boundary):** per-day counter in run.gpx
  DynamoDB (new small entity or attribute keyed `userId + YYYY-MM-DD`, TTL ~3 days) —
  deliberately NOT the run.auth quota engine (it has no daily resetPolicy; adding one
  touches shared infra — separate decision). Admins uncapped.
- The lifetime `strava_sync` quota (16) keeps gating strip LIST refreshes only, and
  matters less once background sync keeps files fresh. Recommend (separately, run.auth):
  add a daily resetPolicy later.

### 4. Strip UX changes

- **Header:** add "Sync now" button (with `remainingToday` count, disabled at 0) next to
  refresh. On success: re-fetch the list + `refreshMyConRuns()`.
- **Cards for imported-but-untagged runs become the tagging UI:** extend
  `GET /api/gpx/strava/activities` to return `fileId` and `conDay` for imported
  activities (join against the same GpxFile partition read the dedupe already does).
  Tapping an imported card with no `conDay` opens the SAME day popover, but confirms via
  `PUT /api/gpx/files/{fileId}` `{ conDay }` (already shipped in #869) instead of import.
  Card states: fresh (tap = import+tag) / imported-untagged (badge "assign a day", tap =
  tag) / imported-tagged (day shown, inert — reassign via Save-as dialog).

## Out of scope

- run.auth quota-engine daily resetPolicy (flagged as separate follow-up).
- Auto-tagging con days during background sync (Kurt chose untagged).
- Any change to #869's selective import path — tap-to-import of a fresh card keeps
  working exactly as shipped.

## Testing

- Unit: rolling-window param precedence (env band vs afterDays), sync-now daily counter
  (boundary at con-local midnight, TTL), activities-list fileId/conDay join.
- Route tests: sync-now (guards, 2/day 429, untagged create), extended activities shape.
- Infra: terragrunt plan for the scheduler instance; verify schedule timezone.
- UAT: watch one 10AM/10PM cycle in prod; strip card state transitions.
