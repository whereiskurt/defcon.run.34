---
phase: 49-leaderboard-data-layer-accomplishment-entity-scoring
plan: 01
subsystem: run.human data layer (ElectroDB entities)
tags: [leaderboard, run-user, rollups, electrodb, tdd]
requires:
  - RunUser entity (apps/run.human/webapp/src/entities/run-user.ts)
provides:
  - RunUser.activityScore / activityCounts{checkin,gpx} / latestActivityAt rollups
  - updateRunUserActivityCounts (sole atomic mutator, floored at 0)
  - activityDelta pure helper (exported, unit-tested)
affects:
  - 49-03 (createAccomplishment/deleteAccomplishment call updateRunUserActivityCounts)
  - Phase 51 (leaderboard scan reads activityScore)
tech-stack:
  added: []
  patterns:
    - "read-modify-write with Math.max(0, …) floor (ported from DC33 UpdateUserAccomplishmentCounts)"
    - "pure helper beside entity, unit-tested without DynamoDB (mirrors admin-report.ts)"
key-files:
  created:
    - apps/run.human/webapp/src/entities/run-user-activity.test.ts
  modified:
    - apps/run.human/webapp/src/entities/run-user.ts
decisions:
  - "updateRunUserActivityCounts uses read-modify-write (not atomic add/subtract) because the floor-at-0 invariant cannot be expressed with a DynamoDB atomic add"
  - "activityDelta.countDelta is ±1 per accomplishment regardless of points value; scoreDelta carries the points"
  - "run-user.ts edit is a clean additive insertion — no existing field reordered, ctfScore/ctfSolves untouched — safe to merge with the CTF judge worktree"
metrics:
  duration: ~3 min (implementation); one-time `npm ci` env setup ran first
  completed: 2026-07-14
  tasks: 2
  files_changed: 2
status: complete
---

# Phase 49 Plan 01: RunUser Leaderboard Rollups + Atomic Mutator Summary

Extended the existing `RunUser` ElectroDB entity with the denormalized leaderboard
rollup fields this board owns — `activityScore`, `activityCounts{checkin,gpx}`,
`latestActivityAt` — plus the single atomic, floored mutator
`updateRunUserActivityCounts` and a pure, unit-tested `activityDelta` helper.
Implements LDBR-02.

## What was built

**Task 1 — default-zero rollup attributes (commit `ecee6c5d`)**
- Added three attributes to the `RunUser` `attributes` map, mirroring the existing
  `checkInCount` default-0 pattern:
  - `activityScore` — number, `default: () => 0`
  - `activityCounts` — map `{ checkin, gpx }`, each `default: () => 0`, map
    `default: () => ({ checkin: 0, gpx: 0 })`
  - `latestActivityAt` — number, optional (no default)
- Added matching optional fields to the exported `RunUserItem` type
  (`activityScore?`, `activityCounts?: { checkin?; gpx? }`, `latestActivityAt?`).
- Strictly additive — no existing field reordered, and `ctfScore`/`ctfSolves`
  (owned by the CTF judge worktree) deliberately left out.

**Task 2 — pure helper + atomic mutator + tests (TDD, commits `10d87b9b` RED, `9606cb5d` GREEN)**
- `activityDelta(source, pointsDelta, increment)` — exported pure helper returning
  `{ scoreDelta, countKey, countDelta }`. `scoreDelta = sign·pointsDelta`,
  `countDelta = sign` (one accomplishment = one count), `countKey` always equals
  the source (never crossed).
- `updateRunUserActivityCounts(userId, { source, pointsDelta, completedAt, increment = true })`
  — the SOLE writer of the three rollup fields. Reads the current row, applies
  the floored delta (`Math.max(0, …)` for both score and count), and writes all
  three fields in one `RunUser.patch(...).set(...)`. Header comment documents the
  single-writer invariant and that it is called ONLY from
  create/deleteAccomplishment (49-03). No caller wired in this plan.
- `run-user-activity.test.ts` — 4 vitest cases covering the four `activityDelta`
  behaviors (increment sign, decrement sign, non-1 points pass-through, count-key
  never crossed).

## Why read-modify-write (not atomic add)

The check-in hook uses `RunUser.patch().add({ checkInCount: 1 })`, but atomic adds
cannot clamp — a decrement of a fresh/zero row would persist a negative total. The
floor-at-0 is a hard invariant (a delete of a mis-recorded accomplishment must
never drive the score negative), so the mutator reads the current value and applies
`Math.max(0, …)`, matching DC33's `UpdateUserAccomplishmentCounts` semantics. The
plan explicitly sanctioned this fallback ("read-modify-write the activityCounts map
inside this same helper — either way keep the 'only via create/delete' invariant").

## Verification

- `npx tsc --noEmit -p tsconfig.json` — no errors in `run-user.ts`. (Four
  pre-existing, unrelated errors remain: `dropdown-user.tsx` missing `@public/*.svg`
  module typing, and `checkin.test.ts` accessing `.model` on the Entity. These are
  out of scope per the executor scope boundary — logged below.)
- `npx vitest run src/entities/run-user-activity.test.ts` (Node 23.6.0) — 4/4 pass.
- Grep invariant confirmed: `activityScore`/`activityCounts`/`latestActivityAt` are
  `.set` only inside `updateRunUserActivityCounts`; no other file references them,
  and no `ctfScore`/`ctfSolves` was added.

## Deviations from Plan

**Environment setup (not a plan deviation, one-time):** the fresh worktree had no
`node_modules` in `apps/run.human/webapp`, so both `tsc` and `vitest` failed with
"Cannot find module" errors. Ran `npm ci` (installs already-declared dependencies
from the committed lockfile — not a new-package add) under Node 23.6.0 before
verifying. No package.json / lockfile changes.

**Out-of-scope pre-existing tsc errors (NOT fixed, per scope boundary):**
- `src/components/header/dropdown-user.tsx:34` — `Cannot find module '@public/header/dcjack.svg'`
- `src/entities/__tests__/checkin.test.ts:108-111` — `Property 'model' does not exist on type 'Entity<…>'`

These predate this plan and are unrelated to `run-user.ts`; left untouched.

Otherwise the plan executed exactly as written.

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/entities/run-user.ts (modified)
- FOUND: apps/run.human/webapp/src/entities/run-user-activity.test.ts (created)
- FOUND commit ecee6c5d (Task 1: rollup attributes)
- FOUND commit 10d87b9b (Task 2 RED: failing activityDelta tests)
- FOUND commit 9606cb5d (Task 2 GREEN: activityDelta + updateRunUserActivityCounts)
