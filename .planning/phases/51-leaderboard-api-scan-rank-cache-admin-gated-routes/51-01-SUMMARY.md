---
phase: 51-leaderboard-api-scan-rank-cache-admin-gated-routes
plan: 01
subsystem: run.human / leaderboard
tags: [leaderboard, ranking, cache, pure-core, tdd, LDBR-07]
requires:
  - lib/leaderboard-scoring.ts (globalScore, rankComparator — Phase 49)
  - entities/run-user.ts (RunUserItem type)
provides:
  - lib/leaderboard-data.ts (buildLeaderboard, isStale, LEADERBOARD_CACHE_TTL_MS, LeaderboardUser/Row/Result types)
affects:
  - Phase 51 plans 02/03 (route handlers assemble on this pure core)
tech-stack:
  added: []
  patterns: [pure-testable-core, tdd-red-green, reuse-dont-rebuild-scoring, no-PII-DTO]
key-files:
  created:
    - apps/run.human/webapp/src/lib/leaderboard-data.ts
    - apps/run.human/webapp/src/lib/leaderboard-data.test.ts
  modified: []
decisions:
  - "globalRank assigned over the FULL sorted list BEFORE filter/paginate (rank stable under filter)"
  - "Reuse Phase-49 globalScore/rankComparator — no re-derived scoring"
  - "LeaderboardUser fields all optional except userId (incl. ctfScore/ctfSolves) so RunUserItem assigns with zero casts"
  - "isStale strictly-greater boundary: at exactly 60s TTL the entry is still fresh"
  - "Filter = case-insensitive displayName contains (Claude's discretion, per CONTEXT)"
metrics:
  tasks: 2
  files: 2
  tests: 15
  completed: 2026-07-14
status: complete
---

# Phase 51 Plan 01: Leaderboard Pure Core (buildLeaderboard + isStale) Summary

Built the DynamoDB-free, fully-unit-tested heart of the leaderboard API: `buildLeaderboard(users, {page,limit,filter})` ranks over the full sorted set then filters+paginates, plus `isStale` + `LEADERBOARD_CACHE_TTL_MS` (60s) cache-staleness primitives — reusing Phase-49 `globalScore`/`rankComparator`, satisfying Phase-51 SC #2 and the pure half of SC #3.

## What Was Built

- **`lib/leaderboard-data.ts`** — pure core, no DynamoDB/network/entity coupling (imports only Phase-49 scoring functions + the `RunUserItem` TYPE):
  - `buildLeaderboard` — sorts a COPY with `rankComparator` (never mutates input), assigns `globalRank = index+1` over the FULL set, maps to a lean DTO, then applies a case-insensitive `displayName`-contains filter and paginates (defaults page 1 / limit 25).
  - `LeaderboardUser` input type — every field optional except `userId`, `mqttUsertype` reuses `RunUserItem["mqttUsertype"]`, `ctfScore`/`ctfSolves` optional (CTF-owned, LDBR-12) → a scanned `RunUserItem` is assignable with zero casts, keeping the plan-02 route tsc-clean.
  - `LeaderboardRow` output DTO — lean: `globalRank, userId, displayName, mqttUsertype, globalScore, activityCounts{checkin,gpx}, ctfSolves`. NO email/PII field (threat T-51-01).
  - `LEADERBOARD_CACHE_TTL_MS = 60_000` + `isStale(now, fetchedAt, ttl?)` returning `now - fetchedAt > ttl` (strictly greater — fresh at exactly TTL).
- **`lib/leaderboard-data.test.ts`** — 15 vitest cases (fixture rows, zero DynamoDB): ranking order + tie-break delegation, ctfScore-absent degrade, rank-stable-under-filter, pagination math + defaults, ctfSolves chip defaults, lean no-PII DTO + zero-normalization + non-mutation, isStale 60s boundary.

## Verification

- `npx vitest run src/lib/leaderboard-data.test.ts` — 15/15 pass (GREEN).
- `npx tsc --noEmit` — PASS: the only remaining errors are the two KNOWN pre-existing out-of-scope ones (`components/header/dropdown-user.tsx` svg module, `entities/__tests__/checkin.test.ts` `.model`); NONE reference `src/lib/leaderboard-data.ts`.

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED: `test(51-01)` commit `15adec25` — suite authored, failed on missing module (confirmed before implementation).
- GREEN: `feat(51-01)` commit `c86458f8` — all 15 cases pass.
- REFACTOR: not needed (implementation clean on first green).

## Threat Coverage

- **T-51-01 (Information Disclosure):** `LeaderboardRow` projects only score/count/name/class fields — asserted by the "no PII field" test (`Object.keys` allowlist + explicit `not.toHaveProperty` for email/emailFull/hash).
- **T-51-02 (Tampering / rank correctness):** rank assigned over the full sorted list before filter/paginate — asserted by the rank-stable-under-filter test (C returns at global rank 3 when filter matches only C).

## Known Stubs

None. (CTF fields `ctfScore`/`ctfSolves` default to 0 by design until the CTF judge ships — LDBR-12 — not a stub.)

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/leaderboard-data.ts
- FOUND: apps/run.human/webapp/src/lib/leaderboard-data.test.ts
- FOUND commit 15adec25 (test/RED)
- FOUND commit c86458f8 (feat/GREEN)
