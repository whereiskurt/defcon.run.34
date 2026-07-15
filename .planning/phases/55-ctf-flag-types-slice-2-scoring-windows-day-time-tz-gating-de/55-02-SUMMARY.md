---
phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de
plan: 02
subsystem: ctf
tags: [ctf, scoring-window, judge, gate-ordering, dst, covert-invariant, tdd]

# Dependency graph
requires:
  - phase: 55-01
    provides: "pure DST-correct isWithinScoreWindow(window, nowMs) + ScoreWindow type + additive Ctf.scoreWindow attribute (ctf-score-window.ts)"
  - phase: 53-ctf-flag-types-slice-1a-backend
    provides: "judgeSolve ordered-gate flow + injectable CtfStore/deps.now/deps.log seam + shared NON_SOLVE constant + ctfJudgeLog (no-guess-param) hygiene"
provides:
  - "judge scoring-window gate (CTFT-10): judgeSolve step 3 — after unlock (1b), before attempt-cap (2); closed/invalid-tz window ⇒ shared NON_SOLVE indistinguishable from a wrong answer"
  - "additive optional JudgeCtf.scoreWindow; absent ⇒ gate is a no-op (backward compat)"
  - "narrowCtf carries row.scoreWindow verbatim onto JudgeCtf (fail-closed coerce of optional map fields)"
affects: [55-03 admin day/time/tz picker (writes the scoreWindow this gate reads)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New ordered judge gate inserted between existing gates — reuses the shared NON_SOLVE + same coarse ctfJudgeLog('no-solve'), so a closed window is byte-identical to a wrong answer on both channels"
    - "Gate consumes the 55-01 pure predicate (isWithinScoreWindow) — DST/tz correctness lives in ONE tested seam, the judge only orders it"
    - "Fail-closed passthrough: narrowCtf coerces the optional scoreWindow map to the required ScoreWindow shape; a malformed/empty tz denies inside isWithinScoreWindow, never crashes"

key-files:
  created:
    - apps/run.human/webapp/src/lib/__tests__/ctf-judge-window.test.ts
  modified:
    - apps/run.human/webapp/src/lib/ctf-judge.ts

key-decisions:
  - "Gate placed AFTER the unlock gate (1b) and BEFORE the attempt-cap gate (2) so a closed window short-circuits before the state-mutating attempt-cap bump AND before any answer validation — proven by the ORDER test asserting overAttemptLimit is never reached"
  - "Reused the shared NON_SOLVE constant + the identical ctfJudgeLog({result:'no-solve'}) the sibling gates emit — the guess/secret is structurally un-loggable (ctfJudgeLog has no value param), so covert invariant T-53-04-01 holds without any covert-file edit"
  - "narrowCtf coerces optional map fields to the required ScoreWindow shape (days ?? [], from/to/tz ?? ''); an empty tz fails-closed via Intl in isWithinScoreWindow (deny), matching 55-01's fail-closed contract"

requirements-completed: [CTFT-10]

coverage:
  - id: W1
    description: "backward compat — a row with NO scoreWindow and a correct guess scores exactly as today"
    requirement: CTFT-10
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-window.test.ts#backward compat (SC-1)"
        status: pass
    human_judgment: false
  - id: W2
    description: "inside the window — a correct guess when now is INSIDE scores"
    requirement: CTFT-10
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-window.test.ts#inside the window (SC-1)"
        status: pass
    human_judgment: false
  - id: W3
    description: "outside the window — a CORRECT guess returns the shared NON_SOLVE (no effect), deep-equals a wrong-answer non-solve, and the log carries no guess"
    requirement: CTFT-10
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-window.test.ts#outside the window is indistinguishable (SC-4)"
        status: pass
    human_judgment: false
  - id: W4
    description: "DST — summer Thu 13:30Z (06:30 PDT) scores; winter Thu 13:30Z (05:30 PST), identical UTC hour, is a non-solve (inherited from the 55-01 predicate)"
    requirement: CTFT-10
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-window.test.ts#DST correctness inherited from the predicate (SC-2)"
        status: pass
    human_judgment: false
  - id: W5
    description: "order — a closed window returns non-solve even when the attempt-cap would ALSO fail, WITHOUT reaching the cap (overAttemptCalls === 0)"
    requirement: CTFT-10
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-window.test.ts#ordered before the attempt-cap gate (CTFT-10)"
        status: pass
    human_judgment: false
  - id: W6
    description: "covert indistinguishable — a closed window on channel 'covert' returns the identical NON_SOLVE with no effect"
    requirement: CTFT-10
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge-window.test.ts#covert-channel indistinguishability (T-53-04-01)"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-15
status: complete
---

# Phase 55 Plan 02: Judge Scoring-Window Gate Summary

**Wired the scoring-window gate (CTFT-10) into `judgeSolve` as ordered step 3 — after the unlock gate (1b), before the attempt-cap gate (2): a closed or invalid-tz window returns the shared `NON_SOLVE`, byte-identical to a wrong answer on both channels, never logging the guess — consuming the 55-01 pure `isWithinScoreWindow` predicate so DST/tz correctness stays in one tested seam.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-15T07:11:45Z
- **Tasks:** 2 (TDD RED → GREEN)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `ctf-judge.ts`: imported `isWithinScoreWindow` + `ScoreWindow` from `ctf-score-window` (55-01); added optional `JudgeCtf.scoreWindow` (absent ⇒ always-open, backward-compatible); inserted the gate immediately after the unlock block and before the attempt-cap block — `if (ctf.scoreWindow && !isWithinScoreWindow(ctf.scoreWindow, now)) { log('no-solve'); return NON_SOLVE; }`.
- `narrowCtf` extended to accept the optional `scoreWindow` map `{ days?, from?, to?, tz? }` and carry it verbatim onto `JudgeCtf`, coercing to the required `ScoreWindow` shape (a malformed/empty tz fails-closed inside `isWithinScoreWindow`).
- Dedicated judge-gate test (`ctf-judge-window.test.ts`, 7 cases across 6 described behaviors): backward-compat, inside, outside (+ deep-equals-wrong + no-guess-in-log), DST summer/winter, gate-order-before-attempt-cap, covert-indistinguishable.
- The closed-window path reuses the shared `NON_SOLVE` constant and the identical `ctfJudgeLog({ result: "no-solve" })` the sibling gates emit — `ctfJudgeLog` structurally cannot carry a guess, so the covert CSS channel invariant (T-53-04-01) holds with zero covert-file edits.

## Task Commits

TDD tasks committed test → feat:

1. **Task 2 (RED): failing judge scoring-window gate test** — `804cc564` (test)
2. **Task 1 (GREEN): wire the gate as judge step 3** — `169cee86` (feat)

## Files Created/Modified
- `apps/run.human/webapp/src/lib/__tests__/ctf-judge-window.test.ts` — created: 7 cases (backward-compat / inside / outside+no-leak / DST / order / covert) driven against an in-memory `CtfStore` fake with injected `deps.now` + capturing `deps.log`.
- `apps/run.human/webapp/src/lib/ctf-judge.ts` — modified: import + optional `JudgeCtf.scoreWindow` + the step-3 gate + `narrowCtf` passthrough.

## Decisions Made
- **Gate placement (after unlock, before attempt-cap):** so a closed window short-circuits before the state-mutating attempt-cap increment and before answer validation. The ORDER test proves it by forcing the attempt-cap to also fail and asserting `overAttemptLimit` was never reached (`overAttemptCalls === 0`).
- **Reuse of the shared NON_SOLVE + coarse log marker:** the gate returns the exact constant and emits the exact `"no-solve"` line the unlock/attempt-cap gates use — indistinguishability is structural, not a re-implementation. No covert file is touched (grep-gated).
- **Fail-closed coercion in narrowCtf:** optional map fields coerce to the required `ScoreWindow`; an empty/undecodable tz denies via Intl inside `isWithinScoreWindow`, inheriting 55-01's fail-closed contract rather than throwing (the judge's outer try/catch would also degrade a throw to NON_SOLVE).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Clean TDD RED (5 of 7 cases failed — the closed-window/order/covert cases scored because the gate was absent) → GREEN (all 7 pass). Full webapp suite 588 tests / 57 files green; `ctf-judge.ts` tsc-clean.

## Threat Mitigations
- **T-55-02-01 / T-55-02-02 (info disclosure — covert leak / gate logging):** mitigated — closed window returns the shared `NON_SOLVE` + the same `no-solve` log; the covert-indistinguishable case asserts no `effect`, and the outside case asserts the captured log contains no guess substring. `ctfJudgeLog` has no value parameter.
- **T-55-02-03 (DoS — Intl throw on bad tz):** mitigated — `isWithinScoreWindow` is fail-closed (55-01) and judgeSolve's outer try/catch already degrades any throw to `NON_SOLVE`.
- **T-55-02-SC (supply chain):** zero new dependencies — reuses the 55-01 pure predicate and built-in `Intl`.

## Verification
- `npx vitest run src/lib/__tests__/ctf-judge-window.test.ts` — 7/7 green.
- `npx vitest run` — full webapp suite 588 tests / 57 files green (backward-compat + no covert regression).
- `npx tsc --noEmit` — no NEW errors; only the two pre-existing out-of-scope errors remain (`header/dropdown-user.tsx` missing svg module decl, `entities/__tests__/checkin.test.ts` `.model`), both documented in 55-01.
- Covert grep gate: `git diff --name-only <pre-plan> HEAD` = exactly `ctf-judge.ts` + `ctf-judge-window.test.ts`; no `covert-egg`/`ctf-covert-css`/`EggTrigger`/`CtfCelebration`/`assets-theme` edit.

## Next Phase Readiness
- **55-03 (admin day/time/tz picker, CTFT-11):** writes the `scoreWindow` this gate now reads. File-disjoint from this plan (CtfForm + ctf-form-model + qr-admin write path); the 55-01 `DEFCON_RUN_HOURS`/`TZ_OPTIONS`/`formStateToScoreWindow`/`scoreWindowToFormState` bridge is ready.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-judge-window.test.ts
- FOUND: apps/run.human/webapp/src/lib/ctf-judge.ts (scoreWindow gate present)
- FOUND commits: 804cc564 (test), 169cee86 (feat)

---
*Phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de*
*Completed: 2026-07-15*
