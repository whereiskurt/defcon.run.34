# Leaderboard ↔ Runs Integration — Design

**Date:** 2026-07-24
**Apps:** run.human (leaderboard, reconcile endpoint, drill display, admin recalc) + run.gpx (reconcile triggers, UI affordance)
**Status:** Approved by Kurt (design conversation 2026-07-23/24)

## Goal

Make the leaderboard a truthful, self-healing reflection of what runners actually did —
runs assigned to con days, social scans, and CTF captures — so it encourages social
scanning, CTF hunting, and run submission. Fix the standing bug where deleted gpx runs
keep their leaderboard points forever.

## Current state (verified 2026-07-23)

- Ranking reads **only `RunUser`** rollup counters (`activityScore` + `ctfScore` =
  `globalScore`, `lib/leaderboard-scoring.ts`). Accomplishment/CtfSolve/CtfScoreEvent
  rows are read only for per-user drill-downs.
- **Delete gap (the reported bug):** run.gpx `DELETE /api/gpx/files/[id]` removes the
  GpxFile + S3 + shares but never notifies run.human. run.human has no internal delete
  endpoint; `deleteAccomplishment` is called only by check-in deletion. Deleted runs keep
  their Accomplishment rows AND their `activityScore` points.
- **Strava imports never counted:** only the file-upload `confirm` route posts to
  `POST /api/internal/accomplishment`. Strava strip imports, scheduled sync imports, and
  conDay PUT changes create no accomplishment.
- Social scans write `CtfScoreEvent` rows (`challenge: social-scan|jack-egg`,
  `bucket: <day>#<pairKey>`) and bump `ctfScore` (+1 / +25) — they already flow into
  `globalScore` but are invisible as line items.
- CTF points-at-time-of-award are persisted on every `CtfSolve` / `CtfScoreEvent` row;
  the main-board drill just doesn't display them.
- Board is admin-gated + unlinked (stays that way for now; launch is a later flip).

## Decisions (locked)

1. **A run earns a leaderboard entry iff it is an active GpxFile with a `conDay`
   assigned** (upload, draw, or Strava import alike). Uploads without a day stop
   counting — reconcile deletes their old accomplishments. 1 point per run
   (`POINTS.strava` = `POINTS.gpx` = 1); the existing per-day import quota caps farming.
2. **Full recalc per user on any change** (not per-event create/delete). Self-healing;
   purges existing stale rows without a separate migration for active users.
3. **Board stays hidden** (admin-gated, no nav). Launch flip is out of scope.
4. **Read cost:** viewing the board must stay O(1) DynamoDB reads per task per minute
   regardless of viewer count (see §5).
5. **No user-facing "recalculate my score" button.** Admin-side per-user Recalculate
   action instead (§6).

## 1. Reconcile seam (run.gpx → run.human)

### run.human: `PUT /api/internal/accomplishment/reconcile`

- Gate: `X-Internal-Secret` (same secret + fallback chain as the existing POST).
- Body: `{ sub, runs: [{ gpxFileId, name, completedAt, conDay, distance, elevation,
  source, stravaActivityId? }] }` — the user's **complete** current list of active,
  con-day-assigned runs. **No polylines** in this call.
- Behavior:
  - Resolve `sub` → adapter userId via `getAdapterUserIdBySub` (benign 200 drop if no
    RunUser, mirroring the POST).
  - Load the user's existing accomplishments with `source in (gpx, strava)`.
  - Diff by deterministic id `"<source>#<gpxFileId>"`:
    - **Orphans** (accomplishment exists, run not in list) → `deleteAccomplishment`
      (existing single-writer rollup reversal keeps `activityScore` honest).
    - **Missing** (run in list, no accomplishment) → returned to caller.
  - Response: `{ ok, missingIds: string[], deleted: number }`.
- run.gpx then POSTs full payloads (with decimated ≤100-pt polylines, exactly the
  existing `buildAccomplishmentPayload` path) for **only the missing ids** via the
  existing `POST /api/internal/accomplishment`, extended to accept `source: "strava"`
  and `conDay`. Two-phase keeps S3 GetObject reads to only-new runs.
- `RunUser.activityCounts` gains a `strava` counter; `createAccomplishment` /
  `deleteAccomplishment` stop skipping the rollup for `strava` source. `POINTS.strava`
  already exists (=1). `deriveCountChips` picks up the new counter.

### run.gpx: `reconcileAccomplishments(userId)` in `lib/gpx-accomplishment.ts`

- Queries the user's active GpxFiles, filters to `conDay != null` and non-GLOBAL,
  builds the summary list, calls the reconcile endpoint, then POSTs full payloads for
  `missingIds`. Best-effort: try/catch-swallow, never blocks or fails the user action
  (same contract as today's `notifyAccomplishment`).
- Trigger call-sites (fire-and-forget after the primary write succeeds):
  1. `files/[id]/confirm` route (replaces the current direct `notifyAccomplishment`).
  2. `files/[id]` PUT when `conDay` is assigned, moved, or **unassigned**.
  3. `files/[id]` DELETE (after the GpxFile row is deleted).
  4. Strava strip import route (`gpx/strava/import`).
  5. Scheduled Strava sync (`syncUserToConDay`) — once per synced user per run.
- Note: the confirm route currently notifies for ANY non-GLOBAL upload; under this
  design a confirm with no conDay results in no accomplishment (reconcile finds
  nothing to add) — intentional behavior change per Decision 1.

### One-off sweep (post-deploy op, not shipped code path)

A local script (offline-prod-write pattern, like the bib identity backfill) that scans
`dc34-gpx` GpxFiles AND run.human gpx/strava-source Accomplishments, unions the user
set, and reconciles each user directly against DynamoDB. Cleans stale rows for users
who never touch run.gpx again. Run once after both apps deploy; guarded by an explicit
`--apply` flag with dry-run default.

## 2. Leaderboard drill-down: show everything (read-time, no new storage)

Extend `GET /api/leaderboard/[userId]/accomplishments` to return three sections,
rendered as grouped lists in the existing accordion row:

- **Runs** — as today (name, source badge, date, distance, polyline thumbnail), now
  including strava-source rows.
- **Social** — the user's `CtfScoreEvent` rows with `challenge == "social-scan"`,
  grouped by the day prefix of `bucket`: **one line per day** — "Social scans ×N (+N)".
  `jack-egg` renders as its own one-time line. Display only; no score change (scans
  already flow through `ctfScore`).
- **CTF flags** — union of `CtfSolve` + `CtfScoreEvent` (excluding the two social
  challenges), one line each: **challenge display name** (joined from the `Ctf` entity;
  fall back to the slug) + **points at time of award** (persisted on the row) + date.
  - **Covert-channel masking:** rows with `channel == "covert"` show their real name
    only when the viewer is the row's owner or an admin; other viewers see
    "Covert flag (+N)". Prevents the board from leaking undiscovered flag intel when
    it later opens up.

Count chips: add a social-scans chip. Scoring formula unchanged
(`globalScore = activityScore + ctfScore`; socialScore is NOT added — it would
double-count).

## 3. gpx-side "counts as accomplishment" affordance

- Strip day-assign dialog + log-a-run save: one line of copy — "Counts as a DEF CON
  accomplishment on the leaderboard".
- On the run itself (My-runs popup / files list): day-assigned runs show a
  "✓ Day N accomplishment" badge; runs without a day show an **"Add as
  accomplishment"** action that opens the existing day picker. No new flows.

## 4. Testing

- run.human: pure reconcile diff function (set math: orphans/missing/idempotent
  re-run) unit-tested; drill grouping + covert masking unit-tested; endpoint gate
  tests mirror the existing internal-accomplishment tests. Full vitest suite +
  `next build`.
- run.gpx: `reconcileAccomplishments` with mocked fetch (two-phase, best-effort
  swallow); trigger call-sites asserted per route. Node 22.12 for vitest.

## 5. Read-cost / caching budget

- **Board list:** unchanged hot path — one `RunUser` scan per app task per 60s
  (`getCachedScan` SWR); rank/filter/pagination in memory over the snapshot. Add
  `Cache-Control: private, max-age=30` so page/filter flips reuse the browser copy.
- **Drill-downs:** wrap the whole assembled drill response (runs + social rollup +
  CTF lines) in an in-memory SWR LRU keyed by userId — 60s TTL, cap ~500 entries —
  plus `Cache-Control: private, max-age=60`. Max 3 queries per drilled user per
  minute per task, regardless of viewer count.
- **Cache bust:** admin Recalculate (§6) and the reconcile endpoint invalidate that
  user's drill cache entry; the 60s board cache is accepted staleness (already
  today's behavior).
- **No CloudFront caching** of these authed routes (shared-cache foot-gun); the
  in-process cache provides the DB protection.
- Writes stay event-driven; viewing never writes.

## 6. Admin per-user Recalculate

- On the existing run.human admin dashboard user view: a "Recalculate score" button
  (admin/runadmin gate, consistent with existing admin actions).
- Server action / route calls run.gpx via a new internal, secret-gated run.gpx
  endpoint `POST /api/internal/reconcile { sub }` that runs
  `reconcileAccomplishments` for that user server-side, then busts the user's drill
  cache entry on run.human. Response surfaces `{ deleted, created }` so the admin
  sees whether anything changed.
- New config: run.human needs `RUN_GPX_INTERNAL_URL` (the reverse of run.gpx's
  existing `RUN_HUMAN_INTERNAL_URL`); the shared internal secret is reused. Both
  wired through the service Terragrunt env the same way the existing seam is.
- No user-facing button, no quota. If real-world drift appears, a quota'd user
  button can reuse the same endpoint later.

## Out of scope

- Leaderboard launch flip (gate relax, nav link, profile rank widget).
- Any change to CTF/social scoring values or award rules.
- CloudFront/edge caching of authed routes.
- Backdating or editing accomplishment history beyond what reconcile derives from
  current GpxFiles.
