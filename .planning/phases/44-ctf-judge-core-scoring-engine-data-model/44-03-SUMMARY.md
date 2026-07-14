---
phase: 44-ctf-judge-core-scoring-engine-data-model
plan: 03
subsystem: run.human/ctf
tags: [ctf, judge, idempotency, concurrency, hygiene, injectable-store]
requires:
  - "44-01: Ctf (extended), CtfSolve, CtfAttempt entities + RunUser ctfScore/ctfSolves"
  - "44-02: computePoints/activeTierCeiling (ctf-scoring), verifyAnswer (ctf-hash)"
provides:
  - "src/lib/ctf-log.ts: ctfJudgeLog (no-value hygiene builder) + emit"
  - "src/lib/ctf-judge.ts: judgeSolve, CtfStore interface, JudgeCtf/JudgeResult/PriorAward types, defaultStore"
affects:
  - "Phase 45 visible /ctf/claim front door (calls judgeSolve)"
  - "Phase 46 covert text/css channel (calls judgeSolve)"
tech-stack:
  added: []
  patterns:
    - "Injectable data-layer seam (CtfStore) + injectable clock + injectable log (deps arg), mirroring live-lockout.ts DI"
    - "Claim-before-allocate ordering: conditional-put CtfSolve BEFORE atomic ADD solveCount → gap-free, cap-safe"
    - "Never-throw contract: top-level try/catch degrades any error to a non-solve (mirrors resolver)"
    - "Structural no-value log builder extends resolver logline.mjs hygiene invariant"
    - "validate-on-load narrowing (narrowCtf): optional 44-01 scoring fields → required ScoringConfig shape, no as any"
key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-log.ts
    - apps/run.human/webapp/src/lib/ctf-judge.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-judge.test.ts
  modified: []
decisions:
  - "getCtf returns a narrowed JudgeCtf (scoring fields coerced to number via narrowCtf) so computePoints/ScoringConfig stay tsc-clean without casts — resolves the 44-01(optional) vs 44-02(required) mismatch at the store seam."
  - "claimSolve catches the create() conditional failure, re-reads the row, and returns the prior award; if no row is found it RE-THROWS so the outer guard degrades to a non-solve rather than mis-reporting a win."
  - "judgeSolve logs at most one ctfJudgeLog line per call and passes only {challenge, result} — never the guess."
  - "over-attempt-limit returns the identical NON_SOLVE shape as a wrong guess (covert invisibility — no oracle)."
metrics:
  tasks_completed: 3
  files_created: 3
  files_modified: 0
  tests_added: 10
  completed: 2026-07-14
status: complete
---

# Phase 44 Plan 03: CTF Judge Core + Log Hygiene + Concurrency Tests Summary

The load-bearing correctness crux of the milestone: `judgeSolve` — the single function both future front doors (Phase 45 visible claim, Phase 46 covert CSS) will call — running the LOCKED 7-step flow behind an injectable `CtfStore` seam + injectable clock + injectable log, proven idempotent, cap-safe under concurrency, never-throwing, and guess-hygienic against an in-memory fake store with zero DynamoDB.

## What Was Built

### `src/lib/ctf-log.ts` (CTF-04)
- **`ctfJudgeLog({ challenge, result })`** → `{ type: "ctf-judge", challenge, result }`. A PURE builder whose signature structurally cannot carry the raw guess (no value/guess/answer parameter). `result` is a coarse marker (`solve` | `no-solve` | `capped` | `replay`). Extends the resolver `logline.mjs` no-value invariant to the run.human judge.
- **`emit(obj)`** → the only side-effecting function (single `console.log(JSON.stringify(obj))`), separable so the judge can inject a spy.

### `src/lib/ctf-judge.ts` (CTF-03)
- **`CtfStore` interface** — the data-layer seam, each op independently fakeable: `getCtf`, `overAttemptLimit`, `claimSolve`, `allocateOrdinal`, `recordScore`, `accrue`.
- **`judgeSolve(input, deps?)`** — the LOCKED flow: (1) load Ctf, missing/`!enabled` → non-solve; (2) `overAttemptLimit` → non-solve (reason hidden); (3) `verifyAnswer` mismatch → non-solve; (4) `claimSolve` conditional-put — a failed claim returns the PRIOR award without re-scoring; (5) `allocateOrdinal` (only reached for genuinely-new solvers → gap-free); (6) `computePoints` + `recordScore` + `accrue`; (7) return. Wrapped in a top-level try/catch so no path throws.
- **`defaultStore`** — electro-backed `CtfStore` on the 44-01 entities (`Ctf`, `CtfSolve`, `CtfAttempt`, `RunUser`). Server-only (imports the electro client via the entities).

### `src/lib/__tests__/ctf-judge.test.ts`
In-memory fake `CtfStore` faithfully modelling the load-bearing semantics; 10 tests, all green.

## Signatures

```ts
// ctf-log.ts
function ctfJudgeLog({ challenge, result }: { challenge: string; result: string })
  : { type: "ctf-judge"; challenge: string; result: string };
function emit(obj: unknown): void;

// ctf-judge.ts
type Channel = "qr" | "covert";
interface JudgeResult { solved: boolean; points: number; ordinal: number | null; firstBlood: boolean; capped: boolean }
interface JudgeCtf extends ScoringConfig { challenge: string; answerHash: string; enabled: boolean; maxAttempts?: number; rateLimitWindow?: number }
interface PriorAward { ordinal: number; points: number; firstBlood: boolean }
interface CtfStore {
  getCtf(challenge: string): Promise<JudgeCtf | null>;
  overAttemptLimit(args: { challenge: string; user: string; window: number; max: number; now: number }): Promise<boolean>;
  claimSolve(args: { challenge: string; user: string; channel: Channel; solvedAt: string }): Promise<{ claimed: boolean; existing?: PriorAward }>;
  allocateOrdinal(challenge: string): Promise<number>;
  recordScore(args: { challenge: string; user: string; ordinal: number; points: number; firstBlood: boolean; tierCeiling: number; channel: Channel }): Promise<void>;
  accrue(args: { user: string; points: number }): Promise<void>;
}
function judgeSolve(
  input: { user: string; challenge: string; guess: string; channel: Channel },
  deps?: { store?: CtfStore; now?: number; log?: (o: unknown) => void },
): Promise<JudgeResult>;
declare const defaultStore: CtfStore;
```

## How the Narrowing Was Done (checker advisory)

44-01 types `Ctf`'s scoring fields (`pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus`) as optional (`number | undefined`), but 44-02's `ScoringConfig` requires them as `number`. Rather than cast at the `computePoints` call site, the mismatch is resolved once at the store seam: `CtfStore.getCtf` returns a `JudgeCtf` (which `extends ScoringConfig`), and `defaultStore.getCtf` runs a `narrowCtf` validate-on-load helper that coerces each optional field with a `?? 0` default and maps `timeTiers` `{from?,to?,ceiling?}[]` → well-typed `TimeTier[]` (`from ?? ""`, `to ?? ""`, `ceiling ?? 0`). `judgeSolve` therefore hands `computePoints` a fully-typed config and `tsc --noEmit` stays clean with no `as any`. (A missing scoring field lands as `0`, and `maxSolves: 0` makes `computePoints` return 0 → `capped`, a safe non-scoring degrade for a mis-configured challenge.)

## Deviations from Plan

None — plan executed exactly as written. The narrowing approach was pre-specified by the checker advisory in the plan prompt and implemented as directed.

## Test Results

`nvm use 23.6.0` then `npx vitest run` — **10/10 green** (whole CTF suite 34/34). `tsc --noEmit` clean across the three new files (the 5 pre-existing unrelated errors in `dropdown-user.tsx` and `checkin.test.ts` are untouched, per scope).

- **Concurrency / gap-free ordinals (SC-2):** 5 users submit the correct flag via `Promise.all`; ordinals are exactly `{1,2,3,4,5}`, `solveCount` advanced exactly 5×, `allocateCalls === 5`, exactly one first-blood, each user `solves === 1`, per-user point totals sum to the results total.
- **Idempotent re-trigger (SC-2):** same-user double-submit + a third replay each return `solved:true` with the SAME points/ordinal as the first solve; `Ctf.solveCount` stays `1`, `allocateCalls` stays `1` (claim-before-allocate proven — losers never allocate), `RunUser.ctfScore` unchanged.
- **Never-throw:** wrong guess → non-solve with no claim/allocation; `getCtf` returning null, a disabled challenge, and a `getCtf` that throws all `resolves` to the non-solve shape without throwing.
- **Invisibility:** over-attempt-limit returns the byte-identical `NON_SOLVE` shape as a wrong guess (no oracle).
- **Hygiene (SC-3):** a spy `log` captures every call; deep-stringifying `log.mock.calls` proves neither the correct flag nor a distinctive wrong guess appears anywhere; every logged record is JSON-serializable; `ctfJudgeLog`'s keys are exactly `[type, challenge, result]` (no `value`/`guess`); the judge emits ≤1 log line per call.

## Self-Check: PASSED
- `apps/run.human/webapp/src/lib/ctf-log.ts` — FOUND
- `apps/run.human/webapp/src/lib/ctf-judge.ts` — FOUND
- `apps/run.human/webapp/src/lib/__tests__/ctf-judge.test.ts` — FOUND
- commits 85272036 (ctf-log), 88225a8c (ctf-judge), 189cf8e5 (tests) — all present on branch
