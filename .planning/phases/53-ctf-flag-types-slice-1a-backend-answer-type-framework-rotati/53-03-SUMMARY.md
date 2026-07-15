---
phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
plan: 03
subsystem: ctf
tags: [ctf, judge, flag-types, otp, repeatable, ledger, atomic, vitest, tdd]

# Dependency graph
requires:
  - phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
    provides: "53-01 Ctf gating fields + CtfScoreEvent ledger (pk=challenge, sk=user#bucket, byUser gsi1) + isRepeatable/scoreBucket; 53-02 verifyTotp (never-throws otp dispatch target)"
  - phase: 44-ctf-judge-core-scoring-engine-data-model
    provides: "judgeSolve LOCKED flow, CtfStore seam, claimSolve/allocateOrdinal/accrue, computePoints, in-memory fake-store test harness"
provides:
  - "judgeSolve ordered flag-types gates: unlock/chaining, answerType dispatch (static hash | otp verifyTotp), repeatable CtfScoreEvent scoring with atomic once-per-window + perPlayerMax + globalMax"
  - "CtfStore + defaultStore gain hasScoreFor, claimScoreEvent (attribute_not_exists conditional put), overPerPlayerMax (bounded byUser count), recordScoreEvent — all optional/additive"
  - "JudgeCtf/narrowCtf carry answerType, otp, unlockAfter, perPlayerIntervalHours, perPlayerMax, globalMax (absent answerType == static)"
  - "ctf-judge-gates.test.ts (9 tests) proving static parity, unlock indistinguishability, otp dispatch, atomic once-per-window, perPlayerMax, globalMax, accrual parity — NO DynamoDB"
affects: [53-04-effect-plumbing, ctf-judge, ctf-covert, qr-resolver]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive store seam: new CtfStore ops are OPTIONAL so a store built for the shipped static path (and the existing 44-01 test literal) stays valid without them — only rows using the new fields invoke them"
    - "Claim-before-allocate for repeatable flags: the CtfScoreEvent attribute_not_exists conditional put (bucket-in-sk) precedes allocateOrdinal, so a losing same-window double-submit never allocates a global ordinal — mirrors the shipped CtfSolve invariant, per-window instead of once-ever"
    - "globalMax enforced off the atomic allocateOrdinal ordinal (n>globalMax => award 0/no accrue) — never a partition query"
    - "Every gate failure returns the SAME NON_SOLVE constant (indistinguishable from a wrong answer) — preserves the covert-channel invariant"
    - "ms->sec boundary: judgeSolve now is epoch MILLISECONDS; verifyTotp/scoreBucket wanting seconds get Math.floor(now/1000) / scoreBucket floors internally"

key-files:
  created:
    - apps/run.human/webapp/src/lib/__tests__/ctf-judge-gates.test.ts
  modified:
    - apps/run.human/webapp/src/lib/ctf-judge.ts

key-decisions:
  - "New CtfStore ops are OPTIONAL (not required) so the existing 44-01 ctf-judge.test.ts store literal keeps type-checking unchanged — the additive seam is why Task 1 touches only ctf-judge.ts. judgeSolve treats an absent method as a LOCKED/degraded non-solve, never a free solve"
  - "Added recordScoreEvent as a 4th store op (the plan explicitly allowed recordScoreEvent OR reuse) — recordScore keys CtfSolve by (challenge,user), wrong for CtfScoreEvent which needs the bucket in the key"
  - "overPerPlayerMax uses a bounded CtfScoreEvent.byUser count scoped to (user,challenge) — the atomic-claim option that fits the existing seam without a new counter entity (D-04 discretion). The just-claimed row is included so an at-cap player reads count>max"
  - "globalMax capped event returns solved:true/points:0/capped:true (not NON_SOLVE) — identical to the shipped static maxSolves cap, so the covert channel (points>0 only) stays dark for it; a genuine solve with no award is not an information-disclosure oracle"

requirements-completed: [CTFT-03, CTFT-04]

coverage:
  - id: D1
    description: "A row with no answerType routes through the static CtfSolve path unchanged and never touches the CtfScoreEvent ledger (SC-1)"
    requirement: "CTFT-04"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-gates.test.ts#gate — static parity"
        status: pass
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge.test.ts (15 tests — shipped static behavior unchanged)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unlock gate withholds scoring until the prerequisite is scored; a locked gate DEEP-EQUALS the wrong-answer NON_SOLVE (indistinguishable) (SC-4)"
    requirement: "CTFT-04"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-gates.test.ts#gate — unlock/chaining indistinguishability"
        status: pass
    human_judgment: false
  - id: D3
    description: "answerType==='otp' validates via verifyTotp (current +/- skew); an invalid code is an indistinguishable NON_SOLVE that never touches the ledger (CTFT-04)"
    requirement: "CTFT-04"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-gates.test.ts#gate — otp answer-type dispatch"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two concurrent same-window rolling-code submits accrue EXACTLY once via the atomic conditional put on CtfScoreEvent (claim-before-allocate); a submit in the next window scores again (SC-3)"
    requirement: "CTFT-03"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-gates.test.ts#gate — atomic once-per-window"
        status: pass
    human_judgment: false
  - id: D5
    description: "perPlayerMax caps a player's total scoring solves; globalMax stops accrual for everyone after N via the atomic allocateOrdinal ordinal (never a partition query) (SC-3)"
    requirement: "CTFT-03"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-gates.test.ts#gate — perPlayerMax + gate — globalMax hard cutoff"
        status: pass
    human_judgment: false
  - id: D6
    description: "CtfScoreEvent scoring accrues into the per-user total exactly like CtfSolve (SC-6)"
    requirement: "CTFT-03"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-gates.test.ts#gate — CtfScoreEvent accrual parity"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-15
status: complete
---

# Phase 53 Plan 03: Judge Flag-Types Gates — Unlock, OTP Dispatch, Repeatable Scoring Summary

**Extended `judgeSolve` from the shipped single-static judge into a multi-answer, chained, repeatable scorer — an unlock/chaining gate, `static`/`otp` answer-type dispatch, and the atomic `CtfScoreEvent` repeatable path (once-per-window conditional put BEFORE the global ordinal, `perPlayerMax`, and `globalMax` off the ordinal) — while keeping every static one-award flag byte-for-byte on `CtfSolve` and every gate failure an indistinguishable `NON_SOLVE`. Proven by a 9-test in-memory gate suite (no DynamoDB); the 15 shipped judge tests stay green.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-15T03:45:24Z
- **Completed:** 2026-07-15T03:53:17Z
- **Tasks:** 2 (both TDD-style; seam extension + gated flow with its proof suite)
- **Files:** 2 (1 created, 1 modified)

## Accomplishments
- **Task 1 — store seam + narrowCtf.** Extended `JudgeCtf`/`narrowCtf` to carry the six flag-types fields (`answerType`, `otp`, `unlockAfter`, `perPlayerIntervalHours`, `perPlayerMax`, `globalMax`; absent `answerType` narrows to `static`). Added four OPTIONAL `CtfStore` ops — `hasScoreFor`, `claimScoreEvent`, `overPerPlayerMax`, `recordScoreEvent` — and implemented them on `defaultStore` over `CtfScoreEvent`, mirroring `claimSolve`'s attribute_not_exists conditional put + catch discipline. Optional-ness keeps the existing 44-01 test's store literal type-clean (the additive seam). Existing 15 judge tests + `tsc` green.
- **Task 2 — ordered gates + proof suite.** Wired the D-05 ordered gates into `judgeSolve`: the unlock gate right after load (locked ⇒ same `NON_SOLVE` as a wrong answer); answer-type dispatch replacing the single hash-validate (`otp` ⇒ `verifyTotp` on the raw code with ms→sec conversion; `static`/absent ⇒ the existing `verifyAnswerHash`/`verifyAnswer`); and the `isRepeatable` branch that claims a `CtfScoreEvent` bucket BEFORE allocating the ordinal, then caps via `overPerPlayerMax` and `globalMax` (n>globalMax ⇒ points 0 / no accrue). The static `CtfSolve` path is untouched and only reached when NOT repeatable.
- **Proof.** New `ctf-judge-gates.test.ts` (9 tests) against a faithful in-memory fake store proving: static parity (ledger untouched), unlock indistinguishability (deep-equal to wrong-answer NON_SOLVE), otp dispatch (valid solves / invalid is a clean miss), atomic once-per-window (`Promise.all` of two identical submits accrues exactly once; next window scores again), `perPlayerMax` cap, `globalMax` (2nd event points 0 / no accrue), and CtfScoreEvent accrual parity.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend CtfStore seam + narrowCtf for the gating fields + CtfScoreEvent ops (CTFT-03/04)** — `e535b0b0` (feat)
2. **Task 2: Wire the ordered flag-types gates into judgeSolve + gate test suite (CTFT-04/03)** — `24e400da` (feat)

**Plan metadata:** see the final `docs(53-03)` commit.

_Note: TDD tasks — Task 1 is a seam extension whose "test" is the shipped `ctf-judge.test.ts` staying green (additive proof); Task 2's RED/GREEN are captured in the single feat commit (new gate suite + the implementation it proves)._

## Files Created/Modified
- `src/lib/ctf-judge.ts` (modified) — `JudgeOtp` type; six new `JudgeCtf`/`narrowCtf` fields; four optional `CtfStore` ops + `defaultStore` implementations over `CtfScoreEvent`; unlock gate, answerType dispatch, and the repeatable `claim→cap→ordinal→globalMax→score→accrue` branch in `judgeSolve`. Static path unchanged.
- `src/lib/__tests__/ctf-judge-gates.test.ts` (created) — 9 gate tests over a full in-memory `CtfStore` fake (models atomic bucket-claim, global ordinal, per-user accrual). No DynamoDB.

## Decisions Made
- **Optional store ops (additive seam):** The new `CtfStore` methods are optional so the shipped 44-01 `ctf-judge.test.ts` store literal keeps type-checking untouched — the reason Task 1 declares only `ctf-judge.ts`. `judgeSolve` treats an absent op as a LOCKED/degraded non-solve (never a free solve): an absent `hasScoreFor` locks the gate; an absent `claimScoreEvent` yields `claimed:false` ⇒ NON_SOLVE.
- **`recordScoreEvent` added (4th op):** `recordScore` patches `CtfSolve` keyed `(challenge,user)`; the ledger row needs the `bucket` in its key, so a dedicated `recordScoreEvent` patches `CtfScoreEvent(challenge,user,bucket)`. The plan explicitly permitted `recordScoreEvent` OR reuse.
- **`overPerPlayerMax` seam (D-04 discretion):** a bounded `CtfScoreEvent.byUser` count scoped to `(user,challenge)` — the atomic option that fits the existing store without a new counter entity. It runs AFTER the just-claimed row exists, so an at-cap player reads `count > max`. The hard once-per-window atomicity that matters (and `globalMax`) is provided by the conditional put + the ordinal, not this count.
- **`globalMax` cap shape:** returns `solved:true / points:0 / capped:true`, identical to the shipped static `maxSolves` cap — so the covert channel (which gates on `points > 0`) stays dark for a capped event; a genuine solve that awards nothing is not a solve oracle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical op] Added `recordScoreEvent` to the CtfStore seam**
- **Found during:** Task 1 (store seam)
- **Issue:** The repeatable path must persist the computed `points`/`tierCeiling` onto the ledger row, but `recordScore` keys `CtfSolve` by `(challenge,user)` — the wrong key for `CtfScoreEvent`, which needs the `bucket`.
- **Fix:** Added an optional `recordScoreEvent({challenge,user,bucket,points,tierCeiling,channel})` op patching `CtfScoreEvent(challenge,user,bucket)`. The plan's Task 1 action explicitly allowed `recordScoreEvent` OR reuse.
- **Files modified:** `src/lib/ctf-judge.ts`
- **Verification:** `ctf-judge-gates.test.ts` accrual-parity + once-per-window tests green.
- **Committed in:** `e535b0b0` (Task 1) + wired in `24e400da` (Task 2).

**Total deviations:** 1 auto-fixed (Rule 2, additive). No scope creep; no behavior change to the static path.

## Threat Model Coverage
- **T-53-03-01 (double-award via concurrent same-code submit — mitigate):** `claimScoreEvent` conditional put on `(user,bucket)` runs BEFORE `allocateOrdinal`; the atomic once-per-window test proves two concurrent identical submits accrue exactly once and the loser never allocates. Verified.
- **T-53-03-02 (gate reveals a solve oracle — mitigate):** every gate failure (unlock, once-per-window collision, perPlayerMax) returns the identical `NON_SOLVE`; the unlock test deep-equals a wrong-answer result. `globalMax` cap stays `points:0` so the covert `points>0` gate stays dark. Verified.
- **T-53-03-03 (globalMax bypass via racy partition count — mitigate):** `globalMax` is enforced off the atomic `allocateOrdinal` ordinal (`n>globalMax ⇒ award 0`), never a partition query. Verified by the globalMax test (ordinal advanced, capped event no-accrue).
- **T-53-03-04 (OTP replay for repeated points — mitigate):** `verifyTotp` + the per-window `CtfScoreEvent` claim bound replays to one award per bucket. Verified by once-per-window + otp tests.
- **T-53-03-05 (guess/secret leak in logs — mitigate):** reused `ctfJudgeLog` (no value field); the otp branch passes the raw code only to `verifyTotp` (which never logs) and never to a log line. Verified by inspection + the shipped log-hygiene suite (unchanged).

## Issues Encountered
- Host default Node is v22.1.0 (below the vitest floor); ran all vitest/tsc under `nvm use 23.6.0` per the repo's documented Node-for-tests gotcha. No other issues.
- Pre-existing repo-wide `tsc` errors in untouched files (`components/header/dropdown-user.tsx` missing `@public/header/dcjack.svg`; `entities/__tests__/checkin.test.ts` `.model` access) are OUT OF SCOPE — carried from before this plan (documented in 53-01 SUMMARY), not introduced here. All plan-touched files type-check clean.

## User Setup Required
None — backend judge slice; no UI, no new env var, no new package, no infra. (The `otp-enroll` reward renderer and admin form are Slice 1b.)

## Next Phase Readiness
- **53-04 (effect-return plumbing):** unblocked — `judgeSolve` now owns the full gated flow; 53-04 adds `effect` to the loaded `Ctf`/`JudgeResult` and surfaces it on the non-covert solve response only. This plan did not touch the `effect` field or the covert path.
- **Slice 1b/2/3:** the backend framework (answer types, repeatable ledger, chaining, caps) is complete for the flagship seed→OTP daily chain minus the Slice-2 time-of-day window and the Slice-1b reveal UI.
- No blockers.

## Self-Check: PASSED

Created file `src/lib/__tests__/ctf-judge-gates.test.ts` exists on disk; both task commits (`e535b0b0`, `24e400da`) are present in git log. Verification green under Node 23.6.0: `ctf-judge-gates.test.ts` (9) + `ctf-judge.test.ts` (15) = 24 tests passing; regression suite `ctf-otp` (31) + `ctf-flag-types` (16) + `qr-admin` (42) + `ctf-key-parity` (6) = 95 passing; `tsc --noEmit` clean for all plan-touched files; grep confirms `claimScoreEvent` precedes `allocateOrdinal` in the repeatable branch (claim-before-allocate).

---
*Phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati*
*Completed: 2026-07-15*
