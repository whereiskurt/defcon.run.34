---
phase: 49-leaderboard-data-layer-accomplishment-entity-scoring
plan: 03
subsystem: run.human data layer (leaderboard)
tags: [electrodb, accomplishment, leaderboard, scoring, idempotency, ctf-boundary]
requires:
  - "49-01: RunUser.updateRunUserActivityCounts (sole rollup writer)"
  - "49-02: leaderboard-scoring.ts POINTS (point values supplied by callers)"
provides:
  - "entities/accomplishment.ts: Accomplishment entity + AccomplishmentItem type"
  - "createAccomplishment / getAccomplishmentsByUser / deleteAccomplishment"
  - "pure helpers: accomplishmentIdFor, findDuplicate, AccomplishmentSource"
affects:
  - "Phase 49-04 check-in hook (createCheckIn/deleteCheckIn will call these)"
  - "Phase 50 GPX accomplishment endpoint; Phase 51 leaderboard read"
tech-stack:
  added: []
  patterns:
    - "Deterministic sk (source#externalId) as a cheap idempotency key"
    - "create-then-side-effect / get-before-decrement mirrors checkin.ts"
key-files:
  created:
    - apps/run.human/webapp/src/entities/accomplishment.ts
    - apps/run.human/webapp/src/entities/accomplishment.test.ts
  modified: []
decisions:
  - "accomplishmentId is deterministic (source#externalId), not a uuid — makes replay a sk collision and idempotency cheap"
  - "polyline stored as a list of {lat,lng} maps (structured points) rather than DC33's encoded-string summary_polyline"
  - "points is a createAccomplishment input param (caller passes POINTS.<source>), not imported here — single source of truth stays in leaderboard-scoring.ts"
  - "strava source persists a row but is skipped on the rollup side (no activityCounts slot; reserved this milestone)"
metrics:
  duration: ~10m
  completed: 2026-07-14
  tasks: 2
  files: 2
status: complete
---

# Phase 49 Plan 03: Accomplishment Entity + Scoring (Write Side) Summary

Ported the DC33 `Accomplishment` entity into run.human as
`entities/accomplishment.ts` on the shared `run-human-electro` table, with a
deterministic-id idempotency guard and atomic RunUser rollup wiring — the
leaderboard's drift-free write path for check-in + GPX runs (Strava reserved),
with CTF structurally excluded at the `source` enum (LDBR-12).

## What was built

- **`Accomplishment` ElectroDB entity** (service `"run"`, `electroClient` /
  `ELECTRO_TABLE`): keys `pk=userId` / `sk=accomplishmentId`; attributes
  `userId, accomplishmentId, type("activity"), source, name, description,
  completedAt, year, isPrivate, metadata{points, polyline[{lat,lng}], distance,
  elevation, gpxFileId, checkInId, stravaActivityId}, createdAt, updatedAt`.
  GSIs mirror DC33: `byType` (`gsi1pk-gsi1sk-index`, pk=`[userId,type]`,
  sk=`completedAt`), `byYear` (`gsi2pk-gsi2sk-index`, pk=`[userId,year]`,
  sk=`completedAt`). `source` enum is `["checkin","gpx","strava"]` ONLY.
- **`type AccomplishmentItem`** + **`type AccomplishmentSource`** exported.
- **Pure helpers** (unit-tested, no DynamoDB): `accomplishmentIdFor(source,
  externalId)` (deterministic `source#externalId`) and `findDuplicate(existing,
  source, externalId)` (matches the source's OWN external-id metadata field).
- **DB helpers**: `createAccomplishment(input)` (deterministic-id idempotency
  short-circuit → `Accomplishment.create` → rollup bump once, increment:true),
  `getAccomplishmentsByUser(userId)` (primary index, all pages),
  `deleteAccomplishment(userId, accomplishmentId)` (get-first, delete, decrement
  once increment:false, no-op on missing row).
- **`accomplishment.test.ts`**: 10 tests over the two pure helpers.

## How it satisfies the plan

- **LDBR-01** — entity + createAccomplishment (row + atomic rollup bump) +
  byType/byYear GSIs + source+external-id dup-guard all present.
- **SC #1 (write side)** — a create raises `activityScore` +
  `activityCounts.<source>` exactly once for a new row; a delete reverses it,
  floored at 0 by the mutator. Replays are no-ops.
- **SC #4 / LDBR-12 (write side)** — `source` can never be `ctf`/`qr` (enum
  forbids it); grep-verified no `"ctf"`/`"qr"` string exists in the file. No CTF
  write path.
- **T-49-05 / T-49-06 / T-49-07** — deterministic-id + get-before-write guards
  double-scoring; enum blocks CTF; get-before-decrement blocks rollup drift on a
  missing/foreign delete.

## Verification

- `npx tsc --noEmit -p tsconfig.json` — no errors in `accomplishment.ts` /
  `accomplishment.test.ts`. (Pre-existing out-of-scope errors remain only in
  `components/header/dropdown-user.tsx` and `entities/__tests__/checkin.test.ts`,
  per the environment notes — not touched by this plan.)
- `npx vitest run src/entities/accomplishment.test.ts` — 10/10 green (Node 23.6.0).
- `grep -nE '"ctf"|"qr"' src/entities/accomplishment.ts` — no matches.
- `updateRunUserActivityCounts` is called only inside `createAccomplishment`
  (increment:true) and `deleteAccomplishment` (increment:false).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking type reconciliation] Strava rollup call guarded to checkin|gpx**
- **Found during:** Task 2
- **Issue:** The plan text says `createAccomplishment` calls
  `updateRunUserActivityCounts(userId, { source, ... })`, but the 49-01 mutator
  (and the `RunUser.activityCounts` map) accept `source: "checkin" | "gpx"` only —
  there is no `strava` slot. Passing the full `AccomplishmentSource` union
  (`"checkin"|"gpx"|"strava"`) is a tsc type error.
- **Fix:** Narrowed both call sites with `if (source === "checkin" || source ===
  "gpx")`. A `strava` accomplishment still persists its row but does not bump the
  rollup — consistent with Strava being reserved this milestone (no Strava write
  path is wired until a later phase). This keeps the create-bumps-once /
  delete-decrements-once invariant type-safe and drift-free for the sources that
  actually write today.
- **Files modified:** apps/run.human/webapp/src/entities/accomplishment.ts
- **Commit:** 8a4076e2

### Design choices within Claude's discretion (per 49-CONTEXT §"Claude's Discretion")

- **Deterministic `accomplishmentId`** (`source#externalId`) chosen over a uuid,
  making idempotency a cheap primary-sk collision (`Accomplishment.get` before
  write) rather than requiring a scan+`findDuplicate` on every create. The pure
  `findDuplicate` helper remains exported/tested as the read-side backstop.
- **`polyline`** modeled as a `list` of `{lat,lng}` maps (structured points for
  the future PolylineRenderer) rather than DC33's encoded-string
  `summary_polyline`.
- **`points`** is a `createAccomplishment` input param (callers pass
  `POINTS.<source>` from `leaderboard-scoring.ts`), keeping point values as a
  single source of truth outside the data module — matches the LDBR-04 check-in
  hook decision.

## Known Stubs

None. This is a complete server-side data module. It is intentionally not yet
imported by any caller — the check-in hook (49-04), GPX endpoint (Phase 50), and
leaderboard read (Phase 51) wire it up in later plans, per the phase boundary.

## TDD Gate Compliance

Task 1 followed RED → GREEN:
- RED: `test(49-03)` commit `f8583d81` (tests fail — module absent).
- GREEN: `feat(49-03)` commit `4aab1a16` (entity + helpers; 10/10 pass).
No REFACTOR needed.

## Commits

- `f8583d81` test(49-03): add failing helper tests (RED)
- `4aab1a16` feat(49-03): Accomplishment entity + pure helpers (GREEN)
- `8a4076e2` feat(49-03): createAccomplishment/get/delete — idempotent, rollup-wired

## Self-Check: PASSED

- Files verified on disk: `accomplishment.ts`, `accomplishment.test.ts`, `49-03-SUMMARY.md`.
- Commits verified in git log: `f8583d81`, `4aab1a16`, `8a4076e2`.
