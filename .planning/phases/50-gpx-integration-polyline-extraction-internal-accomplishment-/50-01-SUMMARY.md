---
phase: 50-gpx-integration-polyline-extraction-internal-accomplishment-
plan: 01
subsystem: api
tags: [nextjs, dynamodb, electrodb, internal-api, gpx, leaderboard, vitest, tdd]

# Dependency graph
requires:
  - phase: 49-leaderboard-data-layer-accomplishment-entity-scoring
    provides: "createAccomplishment (gpx-ready, idempotent on gpxFileId, source enum incl. gpx), POINTS.gpx, Accomplishment.metadata.polyline"
provides:
  - "Secret-gated POST /api/internal/accomplishment (run.human consumer side of the GPX seam)"
  - "Shared exported getAdapterUserIdBySub(sub) on entities/auth-user.ts (GSI1 account bridge)"
  - "Pure buildGpxAccomplishmentInput(body, userId) payload builder (server-fixed source gpx)"
affects: [50-02 (run.gpx producer POSTs to this route), 51 (leaderboard read API), 52 (PolylineRenderer)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared sub->adapterUserId resolver centralized in one place (auth-user.ts); route handlers import it instead of re-declaring the GSI1 query"
    - "Pure payload-builder seam (mirrors checkin.ts buildCheckinAccomplishmentInput) — unit-testable without S3/DynamoDB"
    - "Server-fixed source in the builder as the write-side half of the LDBR-12 CTF boundary"

key-files:
  created:
    - apps/run.human/webapp/src/lib/gpx-accomplishment-input.ts
    - apps/run.human/webapp/src/lib/gpx-accomplishment-input.test.ts
    - apps/run.human/webapp/src/app/api/internal/accomplishment/route.ts
    - apps/run.human/webapp/src/app/api/internal/accomplishment/__tests__/route.test.ts
    - apps/run.human/webapp/src/entities/auth-user.test.ts
  modified:
    - apps/run.human/webapp/src/entities/auth-user.ts
    - apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts

key-decisions:
  - "Extracted getAdapterUserIdBySub to auth-user.ts and repointed BOTH internal-user-route call sites (GET+PATCH) to it, deleting the private duplicate — not just the minimum new-route use."
  - "source is server-fixed to 'gpx' inside the pure builder; the body's source (if any) is ignored (LDBR-12 CTF write boundary)."
  - "Unresolvable sub -> benign 200 {dropped:true} (logs gpxFileId only, never the secret); not a 4xx/5xx."
  - "Added a route-handler test (beyond the pure-builder test) proving all three branches: 403 pre-parse, benign drop, happy-path create-once (plan-checker hardening item)."

patterns-established:
  - "Internal secret gate returns 403 BEFORE body parse or any data-layer access."
  - "createAccomplishment idempotency (gpxFileId) is inherited — the route adds NO dedup of its own."

requirements-completed: [LDBR-06]

coverage:
  - id: D1
    description: "Shared getAdapterUserIdBySub(sub) resolves the authjs GSI1 (ACCOUNT#run.defcon.run / ACCOUNT#{sub}) to the adapter userId, or null when no account maps."
    requirement: LDBR-06
    verification:
      - kind: unit
        ref: "src/entities/auth-user.test.ts#getAdapterUserIdBySub"
        status: pass
    human_judgment: false
  - id: D2
    description: "Private resolveAdapterUserId duplicate removed from internal/user/[oidcSub]/route.ts; both call sites use the shared helper."
    requirement: LDBR-06
    verification:
      - kind: other
        ref: "grep -c 'async function resolveAdapterUserId' internal/user/[oidcSub]/route.ts == 0"
        status: pass
      - kind: unit
        ref: "src/app/api/internal/user/[oidcSub]/__tests__/route.test.ts (existing PATCH suite still green after refactor)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pure buildGpxAccomplishmentInput maps a gpx body to source 'gpx' + type 'activity' + POINTS.gpx, threads polyline/distance/elevation, throws on a bad payload, and never emits a non-gpx source."
    requirement: LDBR-06
    verification:
      - kind: unit
        ref: "src/lib/gpx-accomplishment-input.test.ts#buildGpxAccomplishmentInput"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /api/internal/accomplishment: 403 on wrong/absent x-internal-secret (before body parse), benign 200 {dropped:true} on an unresolvable sub, 200 {ok:true} calling createAccomplishment exactly once on the happy path."
    requirement: LDBR-06
    verification:
      - kind: unit
        ref: "src/app/api/internal/accomplishment/__tests__/route.test.ts#POST /api/internal/accomplishment"
        status: pass
    human_judgment: false

# Metrics
duration: ~12min
completed: 2026-07-14
status: complete
---

# Phase 50 Plan 01: GPX Integration — run.human Internal Accomplishment Endpoint Summary

**Secret-gated `POST /api/internal/accomplishment` that resolves an OIDC sub to the run.human adapter userId (via a newly-shared `getAdapterUserIdBySub`) and calls the Phase-49 `createAccomplishment` with a server-fixed `source:"gpx"` — plus a pure, unit-tested payload builder.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-14T01:07Z (approx)
- **Completed:** 2026-07-14T01:14Z (approx)
- **Tasks:** 2 (both TDD)
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- Extracted the sub→adapterUserId resolver into a shared exported `getAdapterUserIdBySub(sub)` on `entities/auth-user.ts` (GSI1: `ACCOUNT#run.defcon.run` / `ACCOUNT#{sub}` → `Items[0].userId`), and repointed both call sites (GET + PATCH) of the internal user route to it, deleting the private duplicate.
- Added a pure `buildGpxAccomplishmentInput(body, userId)` that fixes `source:"gpx"`/`type:"activity"`/`points: POINTS.gpx`, threads `polyline`/`distance`/`elevation`, and throws on a malformed payload.
- Built the new secret-gated `POST /api/internal/accomplishment` route: 403 before any parse on a bad secret, benign `200 {dropped:true}` (log gpxFileId only) on an unresolvable sub, `200 {ok:true}` calling the existing idempotent `createAccomplishment` on success.
- Wrote 3 test files (16 new tests): resolver, pure builder, and the route handler (the route test proves all three branches per the plan-checker hardening ask).

## Task Commits

Each task committed atomically (TDD → test then feat):

1. **Task 1: Extract shared getAdapterUserIdBySub resolver**
   - `60153a13` (test — RED)
   - `a3d2d0f5` (feat — GREEN)
2. **Task 2: Pure buildGpxAccomplishmentInput + new internal accomplishment route**
   - `ce3ca16a` (test — RED)
   - `210fba21` (feat — GREEN)

_TDD gate sequence satisfied per task: `test(...)` commit precedes each `feat(...)` commit._

## Files Created/Modified
- `src/entities/auth-user.ts` — added exported `getAdapterUserIdBySub(sub)` (shared GSI1 account bridge). **(modified)**
- `src/entities/auth-user.test.ts` — resolver unit tests (resolved id / null path / GSI1 key values). **(created)**
- `src/app/api/internal/user/[oidcSub]/route.ts` — deleted private `resolveAdapterUserId`, imports the shared helper (GET + PATCH). **(modified)**
- `src/lib/gpx-accomplishment-input.ts` — pure `buildGpxAccomplishmentInput`. **(created)**
- `src/lib/gpx-accomplishment-input.test.ts` — pure builder tests (mapping + throws + source-fix). **(created)**
- `src/app/api/internal/accomplishment/route.ts` — new secret-gated POST route. **(created)**
- `src/app/api/internal/accomplishment/__tests__/route.test.ts` — route handler tests (403 pre-parse / benign drop / happy-path create-once). **(created)**

## Decisions Made
- **Did the bonus cleanup:** repointed both existing internal-user-route call sites to the shared helper and removed the duplicate (Context called this a nice-to-have; it was cheap and the existing PATCH test suite still passes, so no scope risk).
- **Route test added** (beyond the required pure-builder test) to prove SC3's three branches at the handler level — the pure builder runs for real inside that test (only the resolver + createAccomplishment are mocked).
- **Bad-payload (e.g. missing name) → 500** via the create-path try/catch, exactly as the plan prescribes (the endpoint is internal server-to-server; run.gpx owns the payload shape).

## Deviations from Plan

None affecting behavior. One addition folded in from the plan-checker hardening notes: the route-handler test file `.../internal/accomplishment/__tests__/route.test.ts` (not in `files_modified`) was created to prove the 403/drop/create branches — a test-only artifact, no production code beyond what the plan specified.

## Issues Encountered
- **Pre-existing, out-of-scope failures (NOT introduced here):** the full run.human suite shows 5 vitest failures + 4 `tsc` errors in `src/entities/__tests__/checkin.test.ts` (`.model` electrodb typing), and 1 `tsc` error in `src/components/header/dropdown-user.tsx` (svg module). These files and `checkin.test.ts`'s entire import graph are untouched by this plan (confirmed via `git diff --name-only`). They are exactly the pre-existing conditions the plan-checker flagged. `tsc` is therefore treated as PASS per the plan-checker interpretation rule (only known pre-existing errors remain; none in files this plan touched). Logged to `deferred-items.md`.

## User Setup Required
None — no new env vars or external service configuration. The route reuses the existing `AUTH_INTERNAL_SECRET` (`config.auth.internalSecret`) already provisioned for the internal user route.

## Next Phase Readiness
- Plan 50-02 (run.gpx producer) can now POST `{ oidcSub, gpxFileId, name, distance, elevation, polyline, completedAt }` with header `x-internal-secret` to this route — the fixed contract is in place.
- No changes to `accomplishment.ts` / `leaderboard-scoring.ts` (Phase 49 remains the sole owner; verified untouched).

## Self-Check: PASSED

All 7 planned/created source files and the SUMMARY exist on disk; all 4 task commits (`60153a13`, `a3d2d0f5`, `ce3ca16a`, `210fba21`) are present in git history.

---
*Phase: 50-gpx-integration-polyline-extraction-internal-accomplishment-*
*Completed: 2026-07-14*
