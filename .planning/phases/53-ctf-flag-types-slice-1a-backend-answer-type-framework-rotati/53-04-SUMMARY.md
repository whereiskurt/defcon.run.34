---
phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
plan: 04
subsystem: ctf
tags: [ctf, judge, flag-types, effect, otp-enroll, covert, invariant, vitest, tdd]

# Dependency graph
requires:
  - phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
    provides: "53-03 gated judgeSolve (unlock/answerType/repeatable), JudgeResult/JudgeCtf/narrowCtf shapes, CtfStore seam; the covert theme route + covert-egg + ctf-covert-css byte-plausible channel (44-46)"
provides:
  - "JudgeResult.effect + JudgeCtf.effect (optional, unknown) — the authored reward payload carried VERBATIM onto a credited (points>0) solve on the non-covert claim response only"
  - "OtpEnrollEffect type {kind:'otp-enroll', otpauth, nextFlag?} — a documented CARRIED payload the judge never interprets (renderer is Slice 1b)"
  - "narrowCtf/getCtf carry row.effect; the covert CSS path proven byte-identical + reward-free by a locking test + source-grep gate"
affects: [53-05, ctf-claim-ui, ctf-covert, slice-1b-reward-renderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Effect is surfaced ONLY on a credited (points>0) solve — capped (points 0) awards and every NON_SOLVE/gate-failure stay effect-free (undefined), so the non-covert claim page shows a reward exactly when points were awarded"
    - "The covert channel learns nothing about rewards: its win gate reads solved+points>0 only; a byte-identity test (win sheet WITH vs WITHOUT effect) + a source-grep gate lock the invariant against future drift"
    - "Untyped passthrough: effect flows Ctf(any) -> narrowCtf(unknown) -> JudgeResult(unknown); the judge never reads the payload, the Slice-1b renderer narrows it"

key-files:
  created:
    - apps/run.human/webapp/src/lib/__tests__/ctf-effect.test.ts
  modified:
    - apps/run.human/webapp/src/lib/ctf-judge.ts
    - apps/run.human/webapp/src/lib/__tests__/covert-egg.test.ts

key-decisions:
  - "Effect gated on points>0 (not just solved): a capped solve (solved:true/points:0) is a non-award and carries no effect — reconciles the plan's 'include effect on the solve returns' with its behavior 'a NON_SOLVE / non-award result carries no effect'. The covert path is unaffected either way (it never reads effect)"
  - "Task 2's covert-invariant tests live in covert-egg.test.ts (the plan's declared file) but drive the real handleCovert with an injected fake judge — the same seam the existing theme route test uses — rather than duplicating the route-test fixture"
  - "Idempotent replay re-surfaces effect off the PRIOR award's points (priorPoints>0), so a replay of a credited flag repeats the reward and a replay of a capped one does not"

requirements-completed: [CTFT-05]

coverage:
  - id: D1
    description: "A credited solve returns the flag's effect (incl. otp-enroll) VERBATIM on JudgeResult; a flag with no effect returns effect===undefined (SC-5)"
    requirement: "CTFT-05"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-effect.test.ts#effect — credited solve surfaces the reward + backward compatible"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every NON_SOLVE / gate-failure (wrong guess, locked unlock gate) returns no effect (undefined) — no reward oracle on a miss (SC-5)"
    requirement: "CTFT-05"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-effect.test.ts#effect — non-solve paths carry no reward"
        status: pass
    human_judgment: false
  - id: D3
    description: "The idempotent replay of a credited award still carries the effect (SC-5)"
    requirement: "CTFT-05"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-effect.test.ts#effect — idempotent replay re-surfaces the reward"
        status: pass
    human_judgment: false
  - id: D4
    description: "The covert CSS win sheet is BYTE-IDENTICAL with vs without an effect on the result, and no reward substring reaches the covert body (SC-5 / T-53-04-01, T-53-04-03)"
    requirement: "CTFT-05"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/covert-egg.test.ts#covert channel stays reward-free — byte-identical + no-substring"
        status: pass
    human_judgment: false
  - id: D5
    description: "A source-grep gate proves the theme route + covert-egg + ctf-covert-css never reference effect/otpauth/otp-enroll (the covert channel cannot learn about rewards) (T-53-04-01)"
    requirement: "CTFT-05"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/covert-egg.test.ts#covert channel stays reward-free — source-grep"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-15
status: complete
---

# Phase 53 Plan 04: Effect-Return Plumbing — Reward on the Non-Covert Solve, Byte-Identical Covert Path Summary

**Wired the authored reward `effect` through `narrowCtf → JudgeResult → judgeSolve` so a CREDITED (points > 0) solve carries it onto the non-covert claim response — including the net-new `{kind:"otp-enroll", otpauth, nextFlag?}` payload the judge carries VERBATIM (renderer is Slice 1b) — while proving the covert CSS channel stays byte-for-byte identical and reward-free by a with/without-effect byte-identity test plus a source-grep gate. Every NON_SOLVE, gate failure, and capped (points 0) award stays effect-free; the covert win gate still reads only `solved && points > 0`.**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-07-15
- **Tasks:** 2 (both TDD-style)
- **Files:** 3 (1 created, 2 modified)

## Accomplishments
- **Task 1 — effect plumbing.** Added optional `effect?: unknown` to `JudgeResult` and `JudgeCtf`; `narrowCtf` (and thus `defaultStore.getCtf`) now carries `row.effect` through untyped. Exported the `OtpEnrollEffect` type (`{kind:"otp-enroll", otpauth, nextFlag?}`) — documented as a carried payload the judge does NOT interpret. On the three credited-capable solve returns (static genuine, static idempotent-replay, repeatable genuine) the result now includes `effect: <points>0 ? ctf.effect : undefined>`; `NON_SOLVE`, every gate-failure, and the `globalMax`-capped literal stay effect-free. Nothing was added to the covert path or to `computePoints`.
- **Task 1 proof.** New `ctf-effect.test.ts` (6 tests, in-memory fake store): a credited solve returns an otp-enroll payload verbatim; an arbitrary non-otp payload passes through untyped; a wrong guess and a locked unlock gate return `NON_SOLVE` with `effect === undefined`; a no-effect flag returns a credited solve with `effect === undefined`; the idempotent replay of a credited award re-surfaces the effect.
- **Task 2 — covert invariant lock.** Extended `covert-egg.test.ts` with a covert-reward-free block that drives the REAL `handleCovert` with an injected fake judge: a credited result WITH an `otp-enroll` effect renders a win sheet byte-for-byte identical to the same credited result WITHOUT an effect (same 200 / text/css / no-store envelope, `AWARD_PROP` present, bodies equal); no `otpauth`/`otp-enroll`/secret substring appears in the covert body; and a source-grep gate asserts the theme route, covert-egg, and ctf-covert-css never reference `effect`/`otpauth`/`otp-enroll`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Plumb reward effect through narrowCtf → JudgeResult → judgeSolve (non-covert only) (CTFT-05)** — `6f54692c` (feat)
2. **Task 2: Lock covert CSS path byte-identical + reward-free (CTFT-05/SC-5)** — `8edce0f8` (test)

_Note: TDD tasks — the RED (new failing test) and GREEN (implementation) are captured together per task, matching the 53-03 precedent for additive plumbing. Task 2 is test-only (adds locking tests; touches no source), so it is a `test(...)` commit._

## Files Created/Modified
- `src/lib/ctf-judge.ts` (modified) — `OtpEnrollEffect` type; `effect?: unknown` on `JudgeResult` + `JudgeCtf`; `narrowCtf` carries `row.effect`; `effect: points>0 ? ctf.effect : undefined` on the static-genuine, static-replay, and repeatable-genuine solve returns. Covert path and `computePoints` untouched.
- `src/lib/__tests__/ctf-effect.test.ts` (created) — 6 effect-plumbing tests over an in-memory `CtfStore` fake. No DynamoDB.
- `src/lib/__tests__/covert-egg.test.ts` (modified) — +1 describe / 3 tests driving the real `handleCovert` (injected fake judge): byte-identity WITH vs WITHOUT effect, no-substring leak, and a source-grep gate over the three covert files.

## Decisions Made
- **Effect gated on `points > 0`, not merely `solved`.** A capped solve (`solved:true / points:0`) is a non-award and carries no effect — this reconciles the plan action ("include `effect: ctf.effect` on the solve returns") with the plan behavior ("a NON_SOLVE / non-award result carries no effect"). The covert channel is unaffected either way because it never reads `effect`; this is purely the non-covert claim semantics (show a reward exactly when points were awarded).
- **Task 2 tests placed in `covert-egg.test.ts`** (the plan's declared file for Task 2) but exercise `handleCovert` via the existing injected-deps seam rather than duplicating the route test's fake-store fixture — a fixed fake judge isolates the ONE variable (effect present/absent).
- **Idempotent replay re-surfaces effect off the prior award's points** (`priorPoints > 0`), so replaying a credited flag repeats the reward and replaying a capped one does not.

## Deviations from Plan

None — plan executed as written. The `points > 0` gate on `effect` is the plan's own stated behavior ("a non-award result carries no effect"), applied uniformly across all solve returns (the plan's Task-1 action named two static returns; the repeatable-genuine return added in 53-03 was given the identical treatment for consistency, and the `globalMax`-capped literal was left effect-free as a non-award).

## Threat Model Coverage
- **T-53-04-01 (reward payload leaks into covert channel — mitigate):** `effect` is returned only on `JudgeResult`; the covert theme route reads `solved && points > 0` only. Proven by the byte-identity test (win sheet WITH vs WITHOUT effect is byte-for-byte equal), the no-substring assertion, and the source-grep gate over the three covert files. Verified.
- **T-53-04-02 (otpauth secret over the wire — accept):** the enrollment `otpauth` is delivered only on the authenticated non-covert solve response (same trust level as meshtk enrollment). Inherent to enrollment; no covert exposure. Accepted per plan.
- **T-53-04-03 (covert sheet drift breaking invisibility — mitigate):** the covert sources are unchanged (only tests were added); win-sheet byte-identity WITH vs WITHOUT an effect is asserted. Verified.

## Issues Encountered
- Host default Node is v22.1.0 (below the vitest floor); ran all vitest/tsc under `nvm use 23.6.0` per the repo's documented Node-for-tests gotcha.
- Pre-existing repo-wide `tsc` errors in untouched files (`components/header/dropdown-user.tsx` missing `@public/header/dcjack.svg`; `entities/__tests__/checkin.test.ts` `.model` access — 5 total) are OUT OF SCOPE, carried from before this plan (documented in 53-01/53-03 SUMMARIES). All plan-touched files type-check clean.

## User Setup Required
None — backend judge slice; no UI, no new env var, no new package, no infra. (The `otp-enroll` reward renderer that consumes `JudgeResult.effect`, and the admin form, are Slice 1b.)

## Next Phase Readiness
- **Slice 1a backend is complete.** `judgeSolve` now owns the full gated flow AND surfaces the reward `effect` on the non-covert solve — the seed→OTP daily chain has every backend piece except the Slice-2 time-of-day window and the Slice-1b reveal UI.
- **Slice 1b (unblocked):** the reward renderer narrows `JudgeResult.effect` to `OtpEnrollEffect` and renders the QR + rolling-code reveal on the claim page (the claim page already passes the whole `JudgeResult` to `ClaimClient`, so `effect` is available there today).
- No blockers.

## Self-Check: PASSED

Created file `src/lib/__tests__/ctf-effect.test.ts` exists on disk; both task commits (`6f54692c`, `8edce0f8`) are present in git log. Verification green under Node 23.6.0: `ctf-effect.test.ts` (6) + `covert-egg.test.ts` (15) + covert route `route.test.ts` (11) = 32 passing; regression `ctf-judge.test.ts` (15) + `ctf-judge-gates.test.ts` (9) = 24 passing; `tsc --noEmit` shows only the 5 pre-existing out-of-scope errors (no new errors in plan-touched files); grep confirms the covert win gate reads `result.solved && result.points > 0` (never `effect`).

---
*Phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati*
*Completed: 2026-07-15*
