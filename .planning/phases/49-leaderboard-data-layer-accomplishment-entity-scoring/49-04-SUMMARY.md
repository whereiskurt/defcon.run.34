---
phase: 49-leaderboard-data-layer-accomplishment-entity-scoring
plan: 04
subsystem: run.human data layer (leaderboard)
tags: [leaderboard, accomplishment, checkin, LDBR-04, idempotency]
requires:
  - "49-02: POINTS constant in lib/leaderboard-scoring.ts"
  - "49-03: createAccomplishment / deleteAccomplishment / accomplishmentIdFor in entities/accomplishment.ts"
provides:
  - "createCheckIn writes the matching activity Accomplishment (source checkin)"
  - "deleteCheckIn reverses it idempotently"
  - "buildCheckinAccomplishmentInput pure seam (exported from checkin.ts)"
affects:
  - "RunUser.activityScore / activityCounts.checkin now rise on check-in, fall on delete"
tech-stack:
  added: []
  patterns:
    - "Pure builder seam (buildCheckinAccomplishmentInput) so DB-side wiring is unit-testable without DynamoDB"
    - "Deterministic accomplishment id (source#externalId) = cheap idempotency"
key-files:
  created:
    - apps/run.human/webapp/src/entities/checkin-hook.test.ts
  modified:
    - apps/run.human/webapp/src/entities/checkin.ts
decisions:
  - "isPrivate default (?? true) is resolved by the CALLER (createCheckIn) so it matches the persisted CheckIn row; the builder carries it verbatim, letting the test prove true/false pass through unchanged (T-49-10)"
  - "Accomplishment name = `Check-in: ${source}` (the check-in's own source label, e.g. Web GPS)"
  - "Kept the accomplishment side effect inline (not fire-and-forget) — check-in and accomplishment share a table and must stay consistent"
metrics:
  duration: ~10m
  completed: 2026-07-14
  tasks: 2
  files: 2
status: complete
---

# Phase 49 Plan 04: Check-in → Accomplishment Hook Summary

Wired the live check-in write path to the Accomplishment entity (LDBR-04): `createCheckIn` now raises exactly one `activity` accomplishment (source `checkin`) carrying the check-in's `isPrivate` + `checkInId`, and `deleteCheckIn` reverses it — both idempotently via a deterministic accomplishment id. This makes SC #1 real end to end: a check-in raises `activityScore`/`activityCounts.checkin`, deleting it undoes that.

## What was built

- **`entities/checkin.ts`**
  - Imports `createAccomplishment`, `deleteAccomplishment`, `accomplishmentIdFor`, `CreateAccomplishmentInput` (from `./accomplishment`) and `POINTS` (from `../lib/leaderboard-scoring`).
  - New pure seam `buildCheckinAccomplishmentInput(seed)` → returns the exact `createAccomplishment` input, fixing `source:"checkin"`, `type:"activity"`, `points: POINTS.checkin`, `completedAt: timestamp`, and threading `isPrivate` verbatim + `checkInId`.
  - `createCheckIn`: after the existing `RunUser.patch(...).add({ checkInCount: 1 })`, calls `createAccomplishment(buildCheckinAccomplishmentInput({ userId, source, timestamp, isPrivate: isPrivate ?? true, checkInId }))`. Signature + return value unchanged.
  - `deleteCheckIn`: after the existing `subtract({ checkInCount: 1 })`, calls `deleteAccomplishment(userId, accomplishmentIdFor("checkin", checkInId))`. Signature unchanged.
- **`entities/checkin-hook.test.ts`** — 5 tests: input shape (source/type/points/completedAt/checkInId/name), `isPrivate` true→true and false→false verbatim, and idempotency (create + delete resolve to the SAME `checkin#<checkInId>` id; distinct check-ins never collide).

## Verification

- `npx tsc --noEmit -p tsconfig.json` — the modified `checkin.ts` and the new `checkin-hook.test.ts` are clean. Remaining errors are the documented pre-existing out-of-scope ones only (`dropdown-user.tsx` svg module, `__tests__/checkin.test.ts` `.model` access) — untouched by this plan.
- `npx vitest run src/entities/checkin-hook.test.ts` (Node 23.6.0) — 5/5 passed.
- Grep confirms `createCheckIn → createAccomplishment(source:"checkin")` (via the builder) and `deleteCheckIn → deleteAccomplishment(accomplishmentIdFor("checkin", checkInId))`.

## Threat mitigations (from plan threat_model)

- **T-49-08** (duplicate on repeated create): deterministic id from `checkInId` + 49-03's get-first dup-guard → replay is a no-op. Test asserts the stable id.
- **T-49-09** (rollup drift on missed delete): `deleteAccomplishment` is idempotent (no-op if gone), floored at 0 in 49-01.
- **T-49-10** (isPrivate lost): carried verbatim; test asserts true/false both preserved.

## Deviations from Plan

None — plan executed as written. The plan explicitly permitted adding + exporting the `buildCheckinAccomplishmentInput` seam in Task 1 so Task 2 could test the pure path; done that way (Task 2 was GREEN on first run since the seam already existed).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/entities/checkin.ts (modified)
- FOUND: apps/run.human/webapp/src/entities/checkin-hook.test.ts (created)
- FOUND commit 6239efee (Task 1)
- FOUND commit 6fed62da (Task 2)
