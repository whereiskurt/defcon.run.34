---
phase: 45-visible-qr-claim-page
plan: 01
subsystem: api
tags: [ctf, hashing, idempotency, dynamodb, electrodb, park-and-claim, tdd]

# Dependency graph
requires:
  - phase: 44-ctf-judge-core-scoring-engine-data-model
    provides: judgeSolve 7-step flow, hashAnswer/verifyAnswer, ctfJudgeLog hygiene, CtfPending schema-only entity, electroClient
provides:
  - verifyAnswerHash — constant-time compare of a pre-hashed submission against Ctf.answerHash
  - judgeSolve guessHash input branch — validate a parked hash without the raw guess
  - createPending / claimPending — reusable, injectable-deps park-and-claim data helpers
affects: [45-02-visible-claim-page, 46-covert-channel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-hashed-guess seam: judgeSolve accepts either guess OR guessHash, branching only at validate (step 3); all other steps untouched."
    - "Park-and-claim: store only submittedFlagHash + TTL; credit exactly once through judgeSolve's conditional-put; delete the nonce on claim."
    - "Injectable deps (store/judge/now/newNonce) mirroring judgeSolve DI so helpers test with no DynamoDB and Phase 46 reuses them verbatim."

key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-pending.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-pending.test.ts
  modified:
    - apps/run.human/webapp/src/lib/ctf-hash.ts
    - apps/run.human/webapp/src/lib/ctf-judge.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-hash.test.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-judge.test.ts

key-decisions:
  - "verifyAnswer refactored to delegate to verifyAnswerHash(hashAnswer(guess), answerHash) — one comparison shared by both paths, byte-identical behavior."
  - "guessHash takes precedence when provided (guessHash !== undefined); otherwise the raw-guess path runs. Empty-guard on both sides returns false, never throws."
  - "claimPending routes ALL credit through judgeSolve (never re-implements scoring); deletes the pending row on claim; judgeSolve's conditional-put is the idempotency backstop if a delete is lost."
  - "30-day TTL stored in epoch SECONDS (DynamoDB TTL contract); challenge normalized via normalizeChallenge on park (getPending returns it already-normalized)."

patterns-established:
  - "Additive judge seam: extend a locked flow by making one input optional + adding a sibling, branching at a single step, leaving the load-bearing ordering intact."
  - "Hash-only park: the raw guess is discarded the instant it is hashed; neither the guess nor the hash reaches any log line."

requirements-completed: [CTF-06]

coverage:
  - id: D1
    description: "verifyAnswerHash constant-time compare + verifyAnswer delegates (byte-identical)"
    requirement: "CTF-06"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-hash.test.ts#verifyAnswerHash"
        status: pass
    human_judgment: false
  - id: D2
    description: "judgeSolve pre-hashed guessHash path — parity, wrong-hash NON_SOLVE, idempotency, hash hygiene"
    requirement: "CTF-06"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge.test.ts#pre-hashed guess path (guessHash) parity"
        status: pass
    human_judgment: false
  - id: D3
    description: "createPending / claimPending park-and-claim helpers — hash-only park, credit-once, no-op re-claim"
    requirement: "CTF-06"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-pending.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-14
status: complete
---

# Phase 45 Plan 01: Park-and-Claim Helpers + Judge Pre-Hashed-Guess Seam Summary

**An unauthenticated QR scan can now park a flag as a hash-only `CtfPending` nonce and later be credited exactly once through the single Phase-44 `judgeSolve` flow, via a new pre-hashed-guess (`guessHash`) validate branch — the raw guess is never stored or logged.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2 completed (both TDD)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Added `verifyAnswerHash(submittedHash, answerHash)` (constant-time hex compare, never throws) and refactored `verifyAnswer` to delegate — one shared comparison, byte-identical behavior, all prior ctf-hash tests still green.
- Added an ADDITIVE `guessHash` branch to `judgeSolve`: `guess` is now optional, and step 3 validates `verifyAnswerHash(guessHash, ctf.answerHash)` when a hash is supplied. Steps 1-2 (attempt-cap) and 4-7 (claim-before-allocate → ordinal → score → accrue → never-throw) are untouched.
- Built `src/lib/ctf-pending.ts` (`createPending` / `claimPending`) with an injectable `PendingStore` + `judge` + `now` + `newNonce` deps seam — server-only, ~135 lines, reusable verbatim by Phase 46.
- Proved (new tests): hashed-path parity with the raw path, wrong-hash → identical NON_SOLVE, credit-exactly-once idempotency, and that neither the raw guess nor the submitted hash appears in any log line.

## Task Commits

Each task was committed atomically (TDD red → green):

1. **Task 1 (RED): failing tests for verifyAnswerHash + guessHash** - `ad30e708` (test)
2. **Task 1 (GREEN): pre-hashed-guess claim seam** - `f158f6eb` (feat)
3. **Task 2 (RED): failing tests for park-and-claim helpers** - `2a13bbef` (test)
4. **Task 2 (GREEN): createPending / claimPending** - `9c10ad42` (feat)

## Files Created/Modified
- `apps/run.human/webapp/src/lib/ctf-hash.ts` - Added `verifyAnswerHash`; `verifyAnswer` now delegates.
- `apps/run.human/webapp/src/lib/ctf-judge.ts` - `judgeSolve` input: `guess?` optional + `guessHash?`; branch at step 3 only.
- `apps/run.human/webapp/src/lib/ctf-pending.ts` - NEW: `createPending`, `claimPending`, `PendingStore`, `defaultPendingStore`, injectable deps.
- `apps/run.human/webapp/src/lib/__tests__/ctf-hash.test.ts` - `verifyAnswerHash` cases + parity assertion.
- `apps/run.human/webapp/src/lib/__tests__/ctf-judge.test.ts` - hashed-path parity / wrong-hash / idempotency / hash-hygiene.
- `apps/run.human/webapp/src/lib/__tests__/ctf-pending.test.ts` - NEW: park-only-hash, credit-once, no-op re-claim, no-leak.

## Signatures

```ts
// ctf-hash.ts
export function verifyAnswerHash(submittedHash: string, answerHash: string): boolean
export function verifyAnswer(guess: string, answerHash: string): boolean // = verifyAnswerHash(hashAnswer(guess), answerHash)

// ctf-judge.ts
export async function judgeSolve(
  input: { user: string; challenge: string; guess?: string; guessHash?: string; channel: Channel },
  deps?: { store?: CtfStore; now?: number; log?: (o: unknown) => void },
): Promise<JudgeResult>

// ctf-pending.ts
export interface PendingRow { nonce: string; challenge: string; submittedFlagHash: string; ttl: number }
export interface PendingStore { putPending(row): Promise<void>; getPending(nonce): Promise<PendingRow|null>; deletePending(nonce): Promise<void> }
export interface PendingDeps { store?: PendingStore; judge?: typeof judgeSolve; now?: number; newNonce?: () => string }
export async function createPending(challenge: string, guess: string, deps?: PendingDeps): Promise<{ nonce: string }>
export async function claimPending(nonce: string, user: string, deps?: PendingDeps): Promise<JudgeResult>
```

## Test Results

- `npx vitest run ctf-hash.test.ts ctf-judge.test.ts ctf-pending.test.ts` → **37 passed** (20 pre-existing Phase-44 tests + 17 new). All Phase-44 judge/hash invariant tests (concurrency/gap-free ordinals, idempotent re-trigger, never-throw, over-limit invisibility, log hygiene) still green.
- New idempotency assertion: double-claim of the same nonce invokes `judge` at most once and returns `NON_SOLVE` on the second call (row consumed); hashed-path re-claim keeps `solveCount`/`ctfScore` unchanged via `judgeSolve`'s conditional-put.
- New hygiene assertion: with a spy `log`, neither the raw guess nor the submitted hash appears in any captured log call.
- `npx tsc --noEmit` → no errors in `ctf-hash.ts` / `ctf-judge.ts` / `ctf-pending.ts` (or their tests). The 2 pre-existing unrelated errors (`dropdown-user.tsx`, `checkin.test.ts`) remain out of scope.

## Decisions Made
See `key-decisions` frontmatter. Notably: `verifyAnswer` delegates to `verifyAnswerHash` (shared compare); `guessHash` takes precedence when provided; all credit routes through `judgeSolve` (no re-implemented scoring).

## Deviations from Plan
None - plan executed exactly as written. (One in-test typing fix: replaced a `vi.fn<[...], ...>` two-type-arg generic — unsupported in vitest 4 — with an inferred typed callback so the test file stays tsc-clean. Runtime behavior unchanged.)

## Threat Model Coverage
- **T-45-01 (info disclosure):** `createPending` stores only `submittedFlagHash = hashAnswer(guess)`; test asserts the raw guess is absent from the stored row and no log/console call carries it. `ctf-pending.ts` has no log/console calls at all.
- **T-45-02 (double-credit EoP):** credit only via `judgeSolve` conditional-put; row deleted on claim; re-claim of a spent/absent nonce no-ops. Proven by the double-claim test.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Self-Check: PASSED
- `apps/run.human/webapp/src/lib/ctf-pending.ts` — FOUND
- `apps/run.human/webapp/src/lib/__tests__/ctf-pending.test.ts` — FOUND
- Commits ad30e708, f158f6eb, 2a13bbef, 9c10ad42 — FOUND
