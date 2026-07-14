---
phase: 44-ctf-judge-core-scoring-engine-data-model
plan: 02
subsystem: run.human/ctf
tags: [ctf, scoring, hashing, pure-logic, tdd]
requires: []
provides:
  - "src/lib/ctf-scoring.ts: activeTierCeiling, computePoints, ScoringConfig type"
  - "src/lib/ctf-hash.ts: hashAnswer, verifyAnswer"
affects:
  - "44-03 judge (computePoints + verifyAnswer callers)"
  - "Phase 47 admin CRUD (hashAnswer on save)"
tech-stack:
  added: []
  patterns:
    - "Injectable clock DI (now?: Date | number) mirroring live-lockout.ts"
    - "Structural (non-entity) ScoringConfig type for parallel-safe plans"
    - "Salted SHA-256 via Node crypto; constant-time verify via timingSafeEqual"
key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-scoring.ts
    - apps/run.human/webapp/src/lib/ctf-hash.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-scoring.test.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-hash.test.ts
  modified: []
decisions:
  - "ScoringConfig is structural (no Ctf entity import) to keep 44-02 parallel-safe with 44-01."
  - "Salt sourced from CTF_ANSWER_SALT with a documented in-code default (static app salt; not a password-grade KDF — matches CONTEXT threat model)."
  - "Answer normalization = trim + lowercase, matching qr-admin.normalizeChallenge."
metrics:
  tasks_completed: 3
  files_created: 4
  files_modified: 0
  tests_added: 24
  completed: 2026-07-14
status: complete
---

# Phase 44 Plan 02: CTF Scoring Engine + Answer Hashing Summary

Two pure, unit-tested primitives the judge composes — the linear-decline scoring engine (`computePoints` + `activeTierCeiling`, CTF-02) and the salted-hash answer seam (`hashAnswer` + `verifyAnswer`, CTF-04) — implemented with an injectable clock and Node `crypto` only, zero new dependencies, zero I/O, and no entity imports (parallel-safe with 44-01).

## What Was Built

### `src/lib/ctf-scoring.ts` (CTF-02)
- **`ScoringConfig`** structural type: `pointMax`, `pointFloor`, `maxSolves`, `firstBloodBonus` (all `number`) + optional `timeTiers: TimeTier[]` where `TimeTier = { from: string; to: string; ceiling: number }`. Deliberately NOT imported from the `Ctf` entity — the loaded row satisfies it by shape.
- **`activeTierCeiling(now, tiers?)`** → first half-open `[from, to)` match's `ceiling`, else `null`. Total: unparseable ISO is skipped (never throws); overlapping windows → first match wins.
- **`computePoints(n, ctf, now?)`** → the LOCKED formula exactly: `n > maxSolves → 0`; `ceiling = activeTierCeiling(now, timeTiers) ?? pointMax`; linear `frac = maxSolves==1 ? 1 : 1-(n-1)/(maxSolves-1)`; `Math.round(pointFloor + span*frac)` + `firstBloodBonus` at `n==1`. The linear line is isolated with a comment marking it as the future curved-swap point. `now` defaults to `Date.now()`.

### `src/lib/ctf-hash.ts` (CTF-04)
- **`hashAnswer(raw)`** → salted SHA-256 hex of the trim+lowercase-normalized answer. Salt from `process.env.CTF_ANSWER_SALT` with a documented in-code default (`dc34-ctf-answer-salt-v1`). Deterministic; raw answer unrecoverable from the digest.
- **`verifyAnswer(guess, answerHash)`** → recomputes `hashAnswer(guess)` and does a constant-time `crypto.timingSafeEqual` over equal-length buffers; returns `false` (never throws) on empty or wrong-length `answerHash`. Never logs `guess`.

## Signatures / Type Shape

```ts
// ctf-scoring.ts
interface TimeTier { from: string; to: string; ceiling: number }
interface ScoringConfig {
  pointMax: number;
  pointFloor: number;
  maxSolves: number;
  firstBloodBonus: number;
  timeTiers?: TimeTier[];
}
function activeTierCeiling(now: Date | number, tiers?: TimeTier[]): number | null
function computePoints(n: number, ctf: ScoringConfig, now?: Date | number): number

// ctf-hash.ts
function hashAnswer(raw: string): string
function verifyAnswer(guess: string, answerHash: string): boolean
```

## Test Results

`npx vitest run` (Node 23.6.0) — **24 tests, 2 files, all green**:
- `ctf-scoring.test.ts` (14): tier in-window / overlap-first-wins / outside-null / half-open `to`-exclusive & `from`-inclusive / empty / garbage-ISO no-throw; `computePoints` n==1 first-blood (ceiling+bonus), n==N floor, n==N+1 → 0, N==1 full ceiling+bonus, mid-curve linear, in-window tier override vs out-of-window `pointMax` fallback, and integer rounding — all with a fixed injected clock.
- `ctf-hash.test.ts` (10): determinism, case/space-insensitivity, distinct inputs differ, 64-hex shape, correct/incorrect verify, empty+short `answerHash` no-throw, and the CTF-04 hygiene substring leak check (raw answer absent from its own hash).

## Verification

- **tsc:** my two lib files produce **0 errors**. `npx tsc --noEmit` reports 5 errors, all pre-existing in unrelated files (`components/header/dropdown-user.tsx` missing-svg-module decl; `entities/__tests__/checkin.test.ts` ElectroDB `.model` typing) — out of scope per the scope boundary; logged, not fixed.
- **No entity import / no I/O:** grep confirms neither lib file references `electroClient` or `entities/`. `ctf-scoring.ts` has zero imports (pure); `ctf-hash.ts` imports only from `crypto`.

## Deviations from Plan

None — plan executed exactly as written. (Tasks 1 & 2 are marked `tdd`; the plan dedicates Task 3 to the full boundary-test matrix and gates Tasks 1/2 on `tsc` only, so source landed first then the comprehensive tests, matching the plan's own verify commands.)

## Threat Mitigations Applied

- **T-44-03** (answerHash leak): salted SHA-256, raw answer never in output, substring leak-check test.
- **T-44-04** (verify timing): `crypto.timingSafeEqual` constant-time compare.
- **T-44-05** (scoring input `n`): `computePoints` caps `n > N → 0`, pure + boundary-tested.
- **T-44-SC** (dependency supply chain): no new dependency — Node `crypto` only.

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/lib/ctf-scoring.ts
- FOUND: apps/run.human/webapp/src/lib/ctf-hash.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-scoring.test.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-hash.test.ts
- FOUND commit de5d6418 (feat T1 scoring)
- FOUND commit 026dfc9d (feat T2 hashing)
- FOUND commit 0227a6c8 (test T3 boundary tests)
