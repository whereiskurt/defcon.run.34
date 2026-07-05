---
phase: 40-admin-activity-reports
plan: 02
subsystem: gpx
tags: [logging, cloudwatch, structured-events, strava, mapbox, vitest, activity-metrics]

# Dependency graph
requires:
  - "LOCKED event-line contract { evt, userId, email, ip, ua, meta } (established by 40-01)"
provides:
  - "logEvent(evt, opts) structured-event helper in run.gpx (single-line JSON to stdout)"
  - "gpx.file.create / gpx.file.publish / gpx.share.request / gpx.share.accept events from the four gpx route handlers"
  - "gpx.map.view leading-indicator event from the mapbox-token GET route (AR-08b)"
  - "strava.ratelimit telemetry line with numeric meta.usage / meta.limit (AR-08c) consumed by 40-04's $.meta.usage metric filter"
affects: [40-04, 40-05, 40-07, admin-reports, metric-filters]

# Tech tracking
tech-stack:
  added:
    - "vitest ^4.1.9 (devDependency) — run.gpx had no test tooling before this plan"
  patterns:
    - "Copy-per-app logEvent helper (identical to run.auth's) emitting one JSON stdout line consumed by CloudWatch metric filters"
    - "Fire-and-forget activity logging wrapped in try/catch so it can never break the request or sync path"
    - "Third-party quota telemetry (Strava rate-limit headers) emitted through the same logEvent contract for a unified metric-filter stream"

key-files:
  created:
    - apps/run.gpx/webapp/src/lib/log-event.ts
    - apps/run.gpx/webapp/src/lib/log-event.test.ts
    - apps/run.gpx/webapp/vitest.config.ts
  modified:
    - apps/run.gpx/webapp/package.json
    - apps/run.gpx/webapp/package-lock.json
    - apps/run.gpx/webapp/src/app/api/gpx/files/route.ts
    - apps/run.gpx/webapp/src/app/api/gpx/files/[id]/publish/route.ts
    - apps/run.gpx/webapp/src/app/api/gpx/files/[id]/request-share/route.ts
    - apps/run.gpx/webapp/src/app/api/gpx/shares/[token]/accept/route.ts
    - apps/run.gpx/webapp/src/app/api/user/mapbox-token/route.ts
    - apps/run.gpx/webapp/src/lib/strava-sync.ts

key-decisions:
  - "gpx.map.view is emitted from the /api/user/mapbox-token GET route: the client fetches the Mapbox token immediately before rendering a map, making it the true server-side leading indicator (our logs are live; the Mapbox usage dashboard lags ~24h)"
  - "strava.ratelimit meta.usage / meta.limit carry the first (15-min-window) hop of the X-RateLimit-Usage / X-RateLimit-Limit comma pairs as numbers — LOCKED field names 40-04 binds to $.meta.usage"
  - "The rate-limit line is emitted once, right after the fetch and before the status branches, so it covers 2xx, 429, and other non-ok responses in a single call site"

patterns-established:
  - "run.gpx is now a producer of the DefconRun/Activity CloudWatch stream with the same logEvent contract as run.auth"

requirements-completed: [AR-01, AR-02, AR-08]

coverage:
  - id: D1
    description: "logEvent helper emits one single-line JSON stdout event with the locked { evt, userId, email, ip, ua, meta } shape, first-hop x-forwarded-for ip, and never throws"
    requirement: "AR-01"
    verification:
      - kind: unit
        ref: "apps/run.gpx/webapp/src/lib/log-event.test.ts#logEvent (6 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five gpx events fire at their locked call sites (create/publish/share-request/share-accept on the four routes + map.view on the mapbox-token route)"
    requirement: "AR-02"
    verification:
      - kind: unit
        ref: "grep: one logEvent( per gpx route file; each evt string present in its route"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p tsconfig.json (exit 0)"
        status: pass
      - kind: manual_procedural
        ref: "prod fire-of-each-event to CloudWatch — deferred to 40-07"
        status: unknown
    human_judgment: true
    rationale: "End-to-end proof that each event reaches the DefconRun/Activity stream requires a live deploy; deferred to 40-07."
  - id: D3
    description: "strava.ratelimit line carries numeric meta.usage / meta.limit from the X-RateLimit headers as the AR-08c metric source"
    requirement: "AR-08"
    verification:
      - kind: unit
        ref: "grep: X-RateLimit x2, strava.ratelimit evt, usage+limit meta fields in strava-sync.ts"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p tsconfig.json (exit 0); sync return values unchanged"
        status: pass
      - kind: manual_procedural
        ref: "live Strava fetch emits a numeric $.meta.usage the 40-04 metric filter resolves — deferred to 40-07"
        status: unknown
    human_judgment: true
    rationale: "Requires a real Strava sync run against live quota headers; deferred to phase-level verification (40-07)."

# Metrics
duration: ~4min
completed: 2026-07-05
status: complete
---

# Phase 40 Plan 02: run.gpx Activity Events Summary

**logEvent structured-event helper in run.gpx (identical contract to run.auth) wired to five gpx.* activity events plus a strava.ratelimit telemetry line carrying the numeric X-RateLimit usage/limit fields that 40-04's metric filter binds to `$.meta.usage`.**

## Performance

- **Duration:** ~4 min
- **Completed:** 2026-07-05
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments
- `logEvent(evt, opts)` copy-per-app helper in run.gpx — byte-for-byte the same `console.log(JSON.stringify(...))` single-line producer as run.auth, with the LOCKED `{ evt, userId, email, ip, ua, meta }` contract, first `x-forwarded-for` hop as `ip`, `Headers`-or-record input, and a try/catch swallow / void return (never throws, never blocks — threat T-40-05).
- vitest unit (6 cases) covering first-hop ip extraction, exact JSON round-trip, single-line output, case-insensitive record-header lookup, undefined-safety, and circular-meta swallow.
- Five gpx activity events fired at their locked call sites:
  - `gpx.file.create` — files POST success (`meta.fileId`)
  - `gpx.file.publish` — publish-to-GLOBAL success (`meta.fileId`)
  - `gpx.share.request` — request-share toggle (`meta.fileId`, `meta.requested`)
  - `gpx.share.accept` — share accept + copy success (`meta.token`, `meta.fileId`)
  - `gpx.map.view` — the mapbox-token GET route, the Mapbox render leading indicator (AR-08b)
- `strava.ratelimit` telemetry: after every Strava fetch in `stravaGet`, one line with numeric `meta.usage` / `meta.limit` (first 15-min-window hop of `X-RateLimit-Usage` / `X-RateLimit-Limit`) for the AR-08c `StravaRateLimitUsage` widget.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing logEvent unit + vitest setup** — `43e24de3` (test)
2. **Task 1 (GREEN): logEvent helper** — `5eed65aa` (feat)
3. **Task 2: wire five gpx activity events** — `cac1ee5a` (feat)
4. **Task 3: strava.ratelimit telemetry in stravaGet** — `b6dfb41b` (feat)

_TDD Task 1: test → feat (no refactor needed — the helper was a clean copy of run.auth's on first pass)._

## Files Created/Modified
- `apps/run.gpx/webapp/src/lib/log-event.ts` — logEvent structured-event helper (created)
- `apps/run.gpx/webapp/src/lib/log-event.test.ts` — vitest unit, 6 behavior cases (created)
- `apps/run.gpx/webapp/vitest.config.ts` — node env + `@` → ./src alias, `src/**/*.test.{ts,tsx}` include (created)
- `apps/run.gpx/webapp/package.json` — added `vitest ^4.1.9` devDep + `test` script (modified)
- `apps/run.gpx/webapp/package-lock.json` — vitest dependency tree (modified)
- `apps/run.gpx/webapp/src/app/api/gpx/files/route.ts` — `gpx.file.create` on POST success (modified)
- `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/publish/route.ts` — `gpx.file.publish` (modified)
- `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/request-share/route.ts` — `gpx.share.request` (modified)
- `apps/run.gpx/webapp/src/app/api/gpx/shares/[token]/accept/route.ts` — `gpx.share.accept` (modified)
- `apps/run.gpx/webapp/src/app/api/user/mapbox-token/route.ts` — `gpx.map.view` leading indicator; added `request` param to GET (modified)
- `apps/run.gpx/webapp/src/lib/strava-sync.ts` — `firstHop` parser + `emitStravaRateLimit` after each `stravaGet` fetch (modified)

## Decisions Made
- **gpx.map.view call site:** the plan left the exact map-view handler to executor discretion ("locate the server-side map view handler … or the nearest server handler that serves the public map data"). Chose the authenticated `/api/user/mapbox-token` GET route because a Mapbox map cannot render until the client fetches its token, so this GET is the true per-render leading indicator — and it already carries `session.user.id` + request headers for full attribution. The unauthenticated `/api/gpx/public/maps` manifest route was the alternative but lacks a user identity and is CDN-cached (5 min s-maxage), which would undercount views.
- **strava.ratelimit single emit point:** placed the emit immediately after the `fetch` and before the 429 / non-ok / ok branches, so one call site covers every response class (satisfies "emit on both the 2xx and the 429 branch") without duplicating the log line.
- **First-hop numeric parse:** `firstHop()` splits the `"15min,daily"` comma pair, takes hop 0, and returns `undefined` for NaN — keeping `meta.usage` / `meta.limit` strictly numeric (or absent) so 40-04's numeric metric filter never trips on a non-numeric value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bootstrapped vitest test infrastructure in run.gpx**
- **Found during:** Task 1 (RED)
- **Issue:** The plan mandates a vitest unit at `src/lib/log-event.test.ts` verified via `npx vitest run …`, but run.gpx had no `vitest` dependency, no `test` script, and no `vitest.config.ts` at all (unlike run.auth in 40-01, which already had them).
- **Fix:** Added `vitest ^4.1.9` as a devDependency and a `test` script to `package.json`, created `vitest.config.ts` (node env + `@` → `./src` alias, mirroring run.auth), and ran `npm install`. Additive and low-risk — no product code affected.
- **Files modified:** apps/run.gpx/webapp/package.json, apps/run.gpx/webapp/package-lock.json, apps/run.gpx/webapp/vitest.config.ts
- **Verification:** vitest suite green (6/6).
- **Committed in:** 43e24de3 (part of the RED test commit)

---

**Total deviations:** 1 auto-fixed (1 blocking test-infra bootstrap).
**Impact on plan:** Required to run the plan's own verify command. No scope creep — no product behavior changed.

## Issues Encountered
- The `admin` worktree had no `node_modules` for run.gpx. Installed deps with `npm install` under node v23.6.0 (per project convention) and ran the locally-installed `./node_modules/.bin/vitest` and `./node_modules/.bin/tsc` — top-level `npx` is avoided here because it pulled a broken rolldown native binary in the sibling 40-01 run. vitest 4.1.9 prints an EBADENGINE warning under node 23.6.0 (it wants ^20 || ^22 || >=24) but runs correctly; warning only, non-fatal.

## User Setup Required
None — no external service configuration required. The CloudWatch metric filters that consume these events (including the `StravaRateLimitUsage` widget on `$.meta.usage`) are built in later Phase 40 plans (40-04/40-05); deploy-time end-to-end verification is deferred to 40-07.

## Next Phase Readiness
- run.gpx now produces the five locked `gpx.*` events plus the `gpx.map.view` leading indicator and the `strava.ratelimit` telemetry line, all through the shared single-line logEvent contract.
- 40-04 can bind its Strava rate-limit metric filter to `$.meta.usage` (numeric) and its gpx activity metrics to the exact `$.evt` strings, both guaranteed by this plan.
- Live proof that each event reaches CloudWatch and that a real Strava sync emits a numeric `$.meta.usage` is deferred to 40-07 (requires a deploy).

## Self-Check: PASSED

All created files present on disk (log-event.ts, log-event.test.ts, vitest.config.ts); all task commits (43e24de3, 5eed65aa, cac1ee5a, b6dfb41b) present in git history.

---
*Phase: 40-admin-activity-reports*
*Completed: 2026-07-05*
