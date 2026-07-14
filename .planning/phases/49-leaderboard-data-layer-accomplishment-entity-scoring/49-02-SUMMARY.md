---
phase: 49-leaderboard-data-layer-accomplishment-entity-scoring
plan: 02
subsystem: run.human leaderboard scoring
tags: [leaderboard, scoring, pure-module, tdd, ctf-boundary]
requires: []
provides:
  - leaderboard-scoring.POINTS
  - leaderboard-scoring.globalScore
  - leaderboard-scoring.totalCount
  - leaderboard-scoring.rankComparator
  - leaderboard-scoring.ScorableUser
affects:
  - Phase 51 leaderboard read/rank API (consumes rankComparator + globalScore)
tech-stack:
  added: []
  patterns:
    - pure colocated .ts + .test.ts helper module (mirrors admin-report.ts)
    - read-only CTF boundary via narrow ScorableUser input shape (LDBR-12)
key-files:
  created:
    - apps/run.human/webapp/src/lib/leaderboard-scoring.ts
    - apps/run.human/webapp/src/lib/leaderboard-scoring.test.ts
  modified: []
decisions:
  - POINTS carries no ctf/qr key; CTF points owned by the CTF judge worktree
  - globalScore = activityScore + (ctfScore ?? 0), degrading cleanly to 0
  - rankComparator ports the DC33 four-level tie order (score → count → recency → age)
metrics:
  duration: ~5m
  completed: 2026-07-14
requirements: [LDBR-03, LDBR-12]
status: complete
---

# Phase 49 Plan 02: Leaderboard Scoring Module Summary

Pure, unit-tested `lib/leaderboard-scoring.ts` — the single source of truth for
how the leaderboard ranks runners: `POINTS` constants, the read-time
`globalScore = activityScore + (ctfScore ?? 0)` sum, `totalCount`, and the DC33
four-level `rankComparator`. Reads the CTF rollup off the passed-in row shape
only (LDBR-12) — no query, no CTF-judge import, no CTF writes.

## What Was Built

- **`POINTS = { checkin: 1, gpx: 1, strava: 1 } as const`** — tunable activity
  point values, no `ctf`/`qr` key (SC #4 read side).
- **`type ScorableUser`** — narrow all-optional read shape (`activityScore?`,
  `activityCounts?: {checkin?, gpx?}`, `latestActivityAt?`, `createdAt?`,
  `ctfScore?`, `ctfSolves?`) — exposes only score/count/timestamp fields, no PII.
- **`globalScore(u)`** = `(u.activityScore ?? 0) + (u.ctfScore ?? 0)` — degrades
  to activityScore when ctfScore unset, to 0 on empty row (SC #2).
- **`totalCount(u)`** = checkin + gpx counts + `(ctfSolves ?? 0)`.
- **`rankComparator(a, b)`** — globalScore desc → totalCount desc →
  latestActivityAt desc (missing = 0) → createdAt asc (older first), ported from
  defcon.run.33 `db/user.ts` lines 762-779 (SC #3).
- **`leaderboard-scoring.test.ts`** — 12 tests: globalScore with/without ctf +
  empty; POINTS shape incl. negative `ctf`/`qr` assertions; totalCount; and a
  comparator suite exercising each tie level plus a full four-level cascade.

## Task Commits

| Task | Name | Type | Commit |
| ---- | ---- | ---- | ------ |
| 1 | Write failing scoring test (RED) | test | 45287837 |
| 2 | Implement leaderboard-scoring.ts (GREEN) | feat | f08a9063 |

## Verification

- `npx vitest run src/lib/leaderboard-scoring.test.ts` → 12 passed (Node 23.6.0).
- RED confirmed before implementation (module-not-found), GREEN after.
- Purity grep `entities/|DynamoDB|electro|fetch\(|ctf-judge|hiddenctfsub` on the
  module → no matches (T-49-03 mitigated: pure/read-only, no CTF import/write).
- `tsc --noEmit` → no errors in the new files.

## Threat Mitigations Applied

- **T-49-03 (Tampering — CTF boundary violation):** module is pure/read-only;
  grep-gate proves no CTF-judge import and no CTF write; `POINTS` has no `ctf`
  key. CTF signal enters only via the read-time `globalScore` sum (LDBR-12).
- **T-49-04 (Info disclosure — accepted):** narrow `ScorableUser` input exposes
  only score/count/timestamp fields, no PII.

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded module header comment to satisfy purity grep**
- **Found during:** Task 2 acceptance check.
- **Issue:** The plan's purity grep (`...|DynamoDB|electro|...`) matched my own
  descriptive header comment ("no DynamoDB, no ElectroDB"), so the "grep returns
  nothing" acceptance criterion would fail on prose alone.
- **Fix:** Reworded the comment to "no database, no ORM/entity coupling" — same
  meaning, no literal trigger tokens. No code/behavior change.
- **Files modified:** apps/run.human/webapp/src/lib/leaderboard-scoring.ts
- **Commit:** f08a9063 (folded into the GREEN commit before it landed)

Otherwise the plan executed exactly as written.

## Known Stubs

None. `ctfScore`/`ctfSolves` default to 0 by design (read-only CTF boundary,
LDBR-12) — this is the locked contract, not a stub; the CTF judge worktree
populates them independently.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/leaderboard-scoring.ts
- FOUND: apps/run.human/webapp/src/lib/leaderboard-scoring.test.ts
- FOUND commit: 45287837 (test RED)
- FOUND commit: f08a9063 (feat GREEN)
