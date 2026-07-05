---
phase: 40-admin-activity-reports
plan: 03
subsystem: run-human
tags: [logging, cloudwatch, structured-events, activity-metrics, vitest, checkin, upload]

# Dependency graph
requires:
  - "40-01 LOCKED event-line contract { evt, userId, email, ip, ua, meta } (run.auth producer to mirror)"
provides:
  - "logEvent(evt, opts) structured-event helper in run.human (single-line JSON to stdout)"
  - "human.checkin event emitted at the POST /api/checkins request boundary"
  - "human.upload event emitted at the GET /api/upload/presign request boundary"
affects: [40-04, admin-reports, metric-filters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Copy-per-app logEvent helper (byte-for-byte with run.auth; no shared package) emitting one JSON stdout line consumed by CloudWatch metric filters"
    - "Activity emit placed at the API-route request boundary (headers + session available), NOT inside the ElectroDB entity function (which has no request headers)"
    - "Fire-and-forget activity logging wrapped in try/catch so it can never break the request path"

key-files:
  created:
    - apps/run.human/webapp/src/lib/log-event.ts
    - apps/run.human/webapp/src/lib/log-event.test.ts
  modified:
    - apps/run.human/webapp/src/app/api/checkins/route.ts
    - apps/run.human/webapp/src/app/api/upload/presign/route.ts

key-decisions:
  - "Emit at the request boundary (API route) rather than the entity write function, because ElectroDB entity functions do not hold request headers — the first x-forwarded-for hop is only available at the route"
  - "logEvent helper is byte-for-byte identical to run.auth's (only the T-40-03->T-40-08 threat-id comment differs) so both producers stay in lockstep with the metric-filter contract"
  - "meta carries the correlating id: { checkinId } for human.checkin, { uploadId, uploadType } for human.upload; email is session.user.email ?? undefined"

patterns-established:
  - "logEvent copy-per-app producer pattern replicated into run.human for the DefconRun/Activity CloudWatch metric-filter stream"
  - "Request-boundary emit rule: entity write functions stay header-free; the calling API route fires the activity event"

requirements-completed: [AR-01, AR-02]

coverage:
  - id: D1
    description: "logEvent helper emits one single-line JSON stdout event with the locked { evt, userId, email, ip, ua, meta } field shape, first-hop x-forwarded-for ip, meta round-trip, and never throws"
    requirement: "AR-01"
    verification:
      - kind: unit
        ref: "apps/run.human/webapp/src/lib/log-event.test.ts#logEvent (6 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/checkins emits evt=human.checkin after the checkin write; GET /api/upload/presign emits evt=human.upload after the upload record is created — both at the request boundary with request headers"
    requirement: "AR-02"
    verification:
      - kind: unit
        ref: "grep -rc 'human.checkin|human.upload' src -> checkins/route.ts:1, upload/presign/route.ts:1"
        status: pass
      - kind: other
        ref: "tsc --noEmit -p tsconfig.json — 0 errors in the four changed files (log-event.ts, log-event.test.ts, checkins/route.ts, presign/route.ts)"
        status: pass
      - kind: manual_procedural
        ref: "prod fire-of-each-event (real checkin + real upload emit two distinct evt lines to CloudWatch) — deferred to 40-07"
        status: unknown
    human_judgment: true
    rationale: "End-to-end proof that a real checkin and a real upload emit the two distinct evt lines to CloudWatch requires a live deploy; deferred to phase-level verification (40-07)."

# Metrics
duration: ~20min
completed: 2026-07-05
status: complete
---

# Phase 40 Plan 03: run.human Activity Events Summary

**logEvent structured-event helper in run.human (byte-for-byte with run.auth) plus human.checkin and human.upload emitted at their API-route request boundaries as single-line JSON to the DefconRun/Activity CloudWatch stream.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-05
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `logEvent(evt, opts)` copy-per-app helper in run.human: one `console.log(JSON.stringify(...))` line with the LOCKED `{ evt, userId, email, ip, ua, meta }` field contract, `ip` = first `x-forwarded-for` hop, `ua` = user-agent; accepts a `Headers` instance or a plain (case-insensitive) record. Identical to run.auth's helper (only the threat-register comment id differs: T-40-08 vs T-40-03).
- Never-throw / never-block guarantee (threat T-40-08): whole body in try/catch, returns void, never awaited.
- vitest unit (6 cases) proving first-hop ip extraction, exact JSON round-trip / meta round-trip, single-line output, record-header case-insensitive lookup, undefined-safety, and circular-meta swallow — uses the real `human.checkin` / `human.upload` evt strings.
- `human.checkin` wired in `POST /api/checkins` immediately after `createCheckIn` succeeds, with `req.headers`, `session.user.id`, `session.user.email`, and `meta: { checkinId }`.
- `human.upload` wired in `GET /api/upload/presign` immediately after `createUpload` creates the pending record (at presigned-URL generation), with `request.headers`, `userId`, `session.user.email`, and `meta: { uploadId, uploadType }`.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing logEvent unit** - `651f92fb` (test)
2. **Task 1 (GREEN): logEvent helper** - `1ab5048b` (feat)
3. **Task 2: wire human.checkin / human.upload at request boundaries** - `71fb2b76` (feat)

_TDD Task 1: test -> feat (no refactor needed — helper was a byte-for-byte copy of run.auth's clean helper)._

## Files Created/Modified
- `apps/run.human/webapp/src/lib/log-event.ts` - `logEvent(evt, opts)` structured-event helper (created)
- `apps/run.human/webapp/src/lib/log-event.test.ts` - vitest unit, 6 behavior cases (created)
- `apps/run.human/webapp/src/app/api/checkins/route.ts` - emit `human.checkin` after the checkin write (modified)
- `apps/run.human/webapp/src/app/api/upload/presign/route.ts` - emit `human.upload` after the upload record create (modified)

## Decisions Made
- **Request-boundary emit, not entity emit:** the plan's `<action>` is explicit that the `logEvent` call goes at the nearest request-boundary caller — the API route — because the ElectroDB entity write functions (`createCheckIn`, `createUpload`) do not receive request headers, and the first `x-forwarded-for` hop is the whole point of the contract. Both write paths are reached through exactly one caller each (`POST /api/checkins`, `GET /api/upload/presign`), so no header threading through the entity layer was needed. Entity signatures and write/response behavior are unchanged.
- **Helper is a verbatim copy of run.auth's:** rather than a re-implementation, the run.human helper is byte-for-byte identical (readHeader, first-hop split, undefined-drop, `meta ?? {}`), guaranteeing the two producers emit the exact same line shape the 40-04 metric filters match on. The only textual difference is the threat-id in a comment (T-40-08 is run.human's DoS-in-write-path row).

## Deviations from Plan

### Placement deviation (frontmatter vs action)

**1. [Plan-internal consistency] Emitted in the API routes, not the entity files listed in frontmatter**
- **Found during:** Task 2
- **Issue:** The plan frontmatter `files_modified` and Task 2 `<files>` list `src/entities/checkin.ts` and `src/entities/user-upload.ts`, but the Task 2 `<action>` explicitly directs the emit to the request-boundary caller "NOT inside the ElectroDB entity function, which has no headers."
- **Resolution:** Followed the `<action>` (authoritative intent) — emitted in `src/app/api/checkins/route.ts` and `src/app/api/upload/presign/route.ts`, the single request-boundary callers. The entity files were left untouched (no header-free emit added). Acceptance criteria (`grep -rc 'human.checkin|human.upload' src` >= 1 each; tsc clean on changed files) are satisfied by the route placement.
- **Impact:** None on the contract — same event strings, same field shape, real client ip now actually available. No product behavior changed.

### Auto-fixed / deferred

**2. [Scope boundary] Pre-existing tsc errors left unfixed**
- **Found during:** Task 2 verify (`tsc --noEmit`)
- **Issue:** The full typecheck reports 5 errors in `src/components/header/dropdown-user.tsx` (missing `*.svg` module declaration) and `src/entities/__tests__/checkin.test.ts` (ElectroDB `.model` access, 4×). None are in the four files this plan changed.
- **Resolution:** Logged to `.planning/phases/40-admin-activity-reports/deferred-items.md`; not fixed (out of scope — unrelated to activity logging). All four files touched by 40-03 are tsc-clean.

---

**Total deviations:** 1 placement resolution (frontmatter vs action), 1 out-of-scope deferral.
**Impact on plan:** None on scope or contract. No product behavior changed.

## Issues Encountered
- The `admin` worktree had no `node_modules`. Installed via `npm ci` under node v23.6.0 (per project convention / 40-01 precedent) and ran the locally installed `./node_modules/.bin/vitest` and `./node_modules/.bin/tsc` (top-level npx pulls a broken rolldown native binary).

## User Setup Required
None - no external service configuration required. The CloudWatch metric filters that consume these events are built in later Phase 40 plans (40-04); deploy-time end-to-end verification is deferred to 40-07.

## Next Phase Readiness
- run.human now joins run.auth (40-01) and run.gpx (40-02) as a producer of the `DefconRun/Activity` stream with the locked field shape and the exact `human.checkin` / `human.upload` event strings that 40-04's metric filters positive-match on (`Checkins`, `Uploads`).
- Live proof that a real checkin and a real upload emit two distinct evt lines is deferred to 40-07 (requires a deploy).

## Self-Check: PASSED

All created/modified files present on disk; all task commits (651f92fb, 1ab5048b, 71fb2b76) present in git history. Unit 6/6 green; changed files tsc-clean.

---
*Phase: 40-admin-activity-reports*
*Completed: 2026-07-05*
