---
phase: 40-admin-activity-reports
plan: 01
subsystem: auth
tags: [logging, cloudwatch, structured-events, next-auth, vitest, activity-metrics]

# Dependency graph
requires: []
provides:
  - "logEvent(evt, opts) structured-event helper in run.auth (single-line JSON to stdout)"
  - "auth.signup / auth.login events emitted from the next-auth jwt callback"
  - "LOCKED event-line contract { evt, userId, email, ip, ua, meta } producer for the DefconRun/Activity stream"
affects: [40-02, 40-03, 40-04, admin-reports, metric-filters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Copy-per-app logEvent helper (no shared package) emitting one JSON stdout line consumed by CloudWatch metric filters"
    - "Fire-and-forget activity logging wrapped in try/catch so it can never break the request/sign-in path"

key-files:
  created:
    - apps/run.auth/webapp/src/lib/log-event.ts
    - apps/run.auth/webapp/src/lib/log-event.test.ts
  modified:
    - apps/run.auth/webapp/src/config/auth.ts
    - apps/run.auth/webapp/vitest.config.ts

key-decisions:
  - "New-vs-returning split determined by a pre-upsert getAuthProfile existence check at the top of the jwt callback (gated on `account` presence), keeping upsertAuthProfile logic untouched"
  - "One insertion point in the jwt callback with a create/update branch yields exactly two logEvent call sites (auth.signup, auth.login)"
  - "ip is the first x-forwarded-for hop; meta always serializes as at least {}"

patterns-established:
  - "logEvent copy-per-app producer pattern for the DefconRun/Activity CloudWatch metric-filter stream"
  - "Activity logging must never throw and never block: try/catch swallow + void return"

requirements-completed: [AR-01, AR-02]

coverage:
  - id: D1
    description: "logEvent helper emits one single-line JSON stdout event with the locked { evt, userId, email, ip, ua, meta } field shape, first-hop x-forwarded-for ip, and never throws"
    requirement: "AR-01"
    verification:
      - kind: unit
        ref: "apps/run.auth/webapp/src/lib/log-event.test.ts#logEvent (6 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "jwt callback emits evt=auth.signup on new-user create and evt=auth.login on returning-user sign-in with request headers"
    requirement: "AR-02"
    verification:
      - kind: unit
        ref: "grep -c 'logEvent(' src/config/auth.ts == 2; grep auth.signup/auth.login >= 1 each"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p tsconfig.json (exit 0, no auth.ts type errors)"
        status: pass
      - kind: manual_procedural
        ref: "prod signup then login emit two distinct evt lines — deferred to 40-07"
        status: unknown
    human_judgment: true
    rationale: "End-to-end proof that a real new-user vs returning sign-in emits the two distinct evt lines to CloudWatch requires a live deploy; deferred to phase-level verification (40-07)."

# Metrics
duration: ~20min
completed: 2026-07-05
status: complete
---

# Phase 40 Plan 01: run.auth Activity Events Summary

**logEvent structured-event helper in run.auth plus a jwt-callback create/update split that emits auth.signup (new users) and auth.login (returning users) as single-line JSON to the DefconRun/Activity CloudWatch stream.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-05
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `logEvent(evt, opts)` copy-per-app helper: one `console.log(JSON.stringify(...))` line with the LOCKED `{ evt, userId, email, ip, ua, meta }` field contract, `ip` = first `x-forwarded-for` hop, `ua` = user-agent; accepts a `Headers` instance or a plain (case-insensitive) record.
- Never-throw / never-block guarantee (threat T-40-03): whole body in try/catch, returns void, never awaited.
- vitest unit (6 cases) proving first-hop ip extraction, exact JSON round-trip, single-line output, record-header lookup, undefined-safety, and circular-meta swallow.
- jwt callback instrumented at one insertion point with a create/update branch: `auth.signup` for brand-new users, `auth.login` for returning users, request headers threaded through for real client-ip attribution.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing logEvent unit + vitest include fix** - `c9341517` (test)
2. **Task 1 (GREEN): logEvent helper** - `92836237` (feat)
3. **Task 2: wire auth.signup / auth.login in jwt callback** - `1dcb1e0a` (feat)

_TDD Task 1: test → feat (no refactor needed — helper was clean on first pass)._

## Files Created/Modified
- `apps/run.auth/webapp/src/lib/log-event.ts` - `logEvent(evt, opts)` structured-event helper (created)
- `apps/run.auth/webapp/src/lib/log-event.test.ts` - vitest unit, 6 behavior cases (created)
- `apps/run.auth/webapp/src/config/auth.ts` - jwt callback create/update split emitting auth.signup / auth.login (modified)
- `apps/run.auth/webapp/vitest.config.ts` - added `src/**/*.test.{ts,tsx}` to include glob so the plan-mandated co-located test is discovered (modified)

## Decisions Made
- **New-vs-returning detection:** rather than change `upsertAuthProfile` (plan forbids), the jwt callback performs a pre-upsert `getAuthProfile(userId)` existence check at the top of the callback, gated on `account` presence (present only on a fresh sign-in, absent on token refresh). A missing profile means create → `auth.signup`; an existing profile means returning → `auth.login`. This runs before the provider branches fire their fire-and-forget upserts, so the check reflects pre-sign-in state.
- **Exactly two call sites:** one create/update branch produces the two `logEvent(` calls the contract expects — no per-provider duplication.
- **meta default `{}`:** always serialize meta as at least an empty object for downstream metric-filter stability; `userId`/`email` are omitted when undefined (JSON.stringify drops undefined keys) per the contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended vitest include glob to discover the co-located test**
- **Found during:** Task 1 (RED)
- **Issue:** The plan mandates the test at `src/lib/log-event.test.ts` and verifies via `vitest run src/lib/log-event.test.ts`, but the existing `vitest.config.ts` include globs only matched `__tests__/` directories, so the co-located file resolved to "No test files found" regardless of the explicit path filter.
- **Fix:** Added `"src/**/*.test.{ts,tsx}"` to the `include` array. Additive and low-risk; the pre-existing `src/config/__tests__/load-existing-grant.test.ts` still passes.
- **Files modified:** apps/run.auth/webapp/vitest.config.ts
- **Verification:** Full suite green — 2 files, 10 tests passed.
- **Committed in:** c9341517 (part of the RED test commit)

---

**Total deviations:** 1 auto-fixed (1 blocking-config).
**Impact on plan:** Necessary to run the plan's own verify command. No scope creep — no product behavior changed.

## Issues Encountered
- The `admin` worktree had no `node_modules`, and top-level `npx vitest` pulled a broken rolldown native binary into the npx cache. Resolved by installing deps via `npm ci` under node v23.6.0 (per project convention) and running the locally installed `./node_modules/.bin/vitest` / `tsc`.

## User Setup Required
None - no external service configuration required. (The CloudWatch metric filters that consume these events are built in later Phase 40 plans; deploy-time end-to-end verification is deferred to 40-07.)

## Next Phase Readiness
- run.auth is now a producer of the `DefconRun/Activity` stream with the locked field shape and exact `auth.signup` / `auth.login` event strings that 40-04's metric filters negative/positive-match on.
- Same copy-per-app `logEvent` pattern is ready to be replicated in run.gpx (40-02) and run.human (40-03).
- Live proof that a real signup then login emit two distinct evt lines is deferred to 40-07 (requires a deploy).

## Self-Check: PASSED

All created/modified files present on disk; all task + summary commits (c9341517, 92836237, 1dcb1e0a, f080a201) present in git history.

---
*Phase: 40-admin-activity-reports*
*Completed: 2026-07-05*
