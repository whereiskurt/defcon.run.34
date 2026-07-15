---
phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
verified: 2026-07-15T04:11:57Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
---

# Phase 53: CTF Flag Types — Slice 1a Backend Verification Report

**Phase Goal:** Extend the shipped CTF judge from a single static-answer model into a multi-answer-type backend — all additive to the `Ctf` entity, fully unit-testable, with NO UI blast radius and the covert-CSS invariant preserved. Adds the `answerType` framework, a `ctf-otp.ts` TOTP core, a `CtfScoreEvent` append-only ledger with atomic once-per-window idempotency, judge gates for unlock/chaining + answer-type dispatch + per-24h/per-player-max/global-max limits, and `effect`-return plumbing.
**Verified:** 2026-07-15T04:11:57Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — the phase contract)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC-1 | A `Ctf` row with no `answerType` scores identically to a static flag today; all new fields optional/additive | ✓ VERIFIED | `qr.ts:138-163` all six fields are optional attributes (no `required`). `narrowCtf` (`ctf-judge.ts:470-471`) coerces absent/unknown `answerType`→`static`. Behavioral: `ctf-judge-gates.test.ts` "gate — static parity (SC-1)" proves a no-answerType row routes through `CtfSolve` untouched; the 15 shipped `ctf-judge.test.ts` tests still pass. |
| SC-2 | `verifyTotp` accepts current ± skew, rejects outside, constant-time; core matches RFC 6238 vectors + period-120 | ✓ VERIFIED | `ctf-otp.ts:182-205` OR's every offset in `[-skew..+skew]` through length-guarded `_constantTimeEqual`→`crypto.timingSafeEqual` (`:164-170`), never short-circuits, never throws. Behavioral: `ctf-otp.test.ts` 31 tests — RFC 6238 vectors (parameterized 30s/8-digit via independent Python oracle), period-120 pin, skew boundary accept/reject, constant-time seam. |
| SC-3 | Repeatable flag scores at most once per window; two concurrent submits award exactly once (atomic bucket-sk conditional put); perPlayerMax caps; globalMax via atomic ordinal | ✓ VERIFIED | `ctf-judge.ts:336-360` claims `CtfScoreEvent` (bucket-in-sk, `attribute_not_exists`) BEFORE `allocateOrdinal`; globalMax off ordinal `n>globalMax⇒points 0/no accrue`. Behavioral: `ctf-judge-gates.test.ts` — "atomic once-per-window" (`Promise.all` two identical submits accrue EXACTLY once; next window scores again), "perPlayerMax", "globalMax hard cutoff (2nd event points 0/no accrue)". |
| SC-4 | Unlock gate withholds until prerequisite scored, and a locked gate is indistinguishable from a wrong answer | ✓ VERIFIED | `ctf-judge.ts:267-275` unlock gate returns the same `NON_SOLVE` constant + same `"no-solve"` log; absent `hasScoreFor` treated as LOCKED (no free solve). Behavioral: `ctf-judge-gates.test.ts` "unlock/chaining indistinguishability" — locked result DEEP-EQUALS the wrong-answer NON_SOLVE, unlocks once prereq scored. |
| SC-5 | Non-covert solve returns `effect` (incl. `otp-enroll`); covert CSS path byte-identical, no reward payload | ✓ VERIFIED | `ctf-judge.ts` returns `effect: points>0 ? ctf.effect : undefined` on all credited-solve returns (`:373,:392,:418`); `NON_SOLVE`/gate-failures/capped stay effect-free. Covert win gate `theme/route.ts:97` reads `result.solved && result.points > 0` only; `covert-egg.ts`/`ctf-covert-css.ts` have ZERO effect/otpauth refs (grep confirmed). Behavioral: `ctf-effect.test.ts` (6) + `covert-egg.test.ts` reward-free block (byte-identical WITH vs WITHOUT effect, no-substring, source-grep gate). |
| SC-6 | `CtfScoreEvent` accrual sums into `RunUser.ctfScore`/`ctfSolves` exactly as `accrue`; static writes `CtfSolve` untouched | ✓ VERIFIED | `ctf-judge.ts:369` repeatable path calls the same `store.accrue({user, points})`; static path (`:376-414`) unchanged. Behavioral: `ctf-judge-gates.test.ts` "CtfScoreEvent accrual parity (SC-6)" — ledger events sum into per-user total exactly as CtfSolve would. |

**Score:** 6/6 truths verified (0 present, behavior-unverified). Every behavior-dependent truth (SC-1/3/4/5/6 state-transition + atomic invariants) is backed by a passing named behavioral test, not symbol presence alone.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/ctf-flag-types.ts` | Pure `isRepeatable`/`scoreBucket`/`assertAnswerTypeTransition` | ✓ VERIFIED | 85 lines, no electro import (only `qr-errors`). Imported by `ctf-judge.ts:11` and `qr-admin.ts:5`. 16 unit tests. |
| `src/lib/ctf-otp.ts` | TOTP core `parseOtpauth`/`totpAt`/`adjacentCodes`/`verifyTotp` + base32 | ✓ VERIFIED | 247 lines, imports ONLY `node:crypto`. `verifyTotp` consumed by `ctf-judge.ts:12,304`. 31 unit tests. |
| `src/entities/ctf.ts` (CtfScoreEvent) | Append-only ledger pk=challenge/sk=user#bucket + byUser gsi1 | ✓ VERIFIED | `:90-134` entity + `CtfScoreEventItem` type `:214`. Consumed by `ctf-judge.ts` defaultStore + `qr-admin.ts` guard. Keys pinned by `ctf-key-parity.test.ts`. |
| `src/entities/qr.ts` (Ctf fields) | 6 optional additive gating fields | ✓ VERIFIED | `:138-163` answerType/otp/unlockAfter/perPlayerIntervalHours/perPlayerMax/globalMax, all optional; distinct globalMax↔maxSolves comments present. |
| `src/lib/ctf-judge.ts` | Unlock/dispatch/repeatable gates + effect plumbing | ✓ VERIFIED | 623 lines. Ordered gates wired into `judgeSolve`; `CtfStore` seam + `defaultStore` extended with `hasScoreFor`/`claimScoreEvent`/`overPerPlayerMax`/`recordScoreEvent`. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `ctf-judge.ts` | `ctf-flag-types.ts` | `isRepeatable`, `scoreBucket` | ✓ WIRED | Imported `:11`, called `:329-333`. |
| `ctf-judge.ts` | `ctf-otp.ts` | `verifyTotp` for `answerType==='otp'` | ✓ WIRED | Imported `:12`, dispatched `:304`. |
| `judgeSolve` | `CtfScoreEvent` | `claimScoreEvent` conditional put BEFORE `allocateOrdinal` | ✓ WIRED | claim `:336`, allocate `:356` — claim-before-allocate confirmed by source order + concurrency test. |
| `qr-admin.upsertCtf` | `assertAnswerTypeTransition` | flip guard gated on `challengeHasSolves` | ✓ WIRED | `:387-388` guard call precedes patch write `:389`; existence read `:402-407` limit-1 per partition. |
| `judgeSolve` | non-covert claim | `effect` on `JudgeResult` | ✓ WIRED | `JudgeResult.effect` returned on credited solves; covert route reads solved+points only. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full phase-53 ctf/covert suites | `npx vitest run` (7 files, Node 23.6.0) | 98 passed (98) | ✓ PASS |
| ctf-otp RFC/skew/constant-time | `ctf-otp.test.ts` | 31 passed | ✓ PASS |
| judge gates (unlock/otp/atomic/caps/accrual) | `ctf-judge-gates.test.ts` | 9 passed | ✓ PASS |
| effect plumbing | `ctf-effect.test.ts` | 6 passed | ✓ PASS |
| covert byte-identical + reward-free | `covert-egg.test.ts` | 15 passed | ✓ PASS |
| shipped static judge regression | `ctf-judge.test.ts` | 15 passed | ✓ PASS |
| CtfScoreEvent key parity | `ctf-key-parity.test.ts` | 6 passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CTFT-01 | 53-01 | Additive `Ctf` entity fields (all optional) | ✓ SATISFIED | `qr.ts:138-163` + `CtfInput` passthrough. |
| CTFT-02 | 53-02 | `ctf-otp.ts` TOTP core + NEW verify/skew | ✓ SATISFIED | `ctf-otp.ts` + 31 tests. |
| CTFT-03 | 53-01, 53-03 | `CtfScoreEvent` ledger + repeatable routing + accrual | ✓ SATISFIED | Entity + judge repeatable path + accrual-parity test. |
| CTFT-04 | 53-03 | Ordered judge gates (unlock/dispatch/cadence/perPlayerMax/globalMax) | ✓ SATISFIED | `judgeSolve` ordered gates + 9 gate tests. |
| CTFT-05 | 53-04 | `effect`-return plumbing (non-covert only) + covert byte-identical | ✓ SATISFIED | `effect` on JudgeResult + covert invariant tests. |
| CTFT-06 | 53-01 | Edit-semantics guard (disallow static↔repeatable flip once solves exist) | ✓ SATISFIED | `assertAnswerTypeTransition` wired into `upsertCtf` + unit tests. |

_Note: v2.3 has no active REQUIREMENTS.md (per verification brief); traceability is via ROADMAP.md + PLAN/SUMMARY `requirements-completed`. All 6 IDs declared across plan frontmatter are covered; none orphaned._

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER in any phase-modified source | ℹ️ Info | Clean. `ctf-otp.ts` import-pure (`node:crypto` only). No stub/empty-return patterns in the scoring paths. |

### Human Verification Required

None. This is a backend-only slice with an explicit "no UI blast radius" boundary — no visual surface, no external service, no runtime deployment introduced. Every observable truth is a state-transition/atomic-invariant proven by a passing named behavioral test (concurrency via `Promise.all`, indistinguishability via deep-equal, covert byte-identity via string comparison). Nothing requires human eyes at this slice.

### Gaps Summary

No gaps. All 6 ROADMAP Success Criteria are VERIFIED with behavioral test evidence, all 6 CTFT requirements are satisfied, all artifacts exist/substantive/wired, all key links connected, the covert-CSS invariant is proven byte-identical + reward-free, and backward compatibility with shipped static flags is proven (15 unchanged judge tests green). All claimed commits resolve in git history.

Two design nuances observed (both intentional per D-04 executor discretion, tested, and non-blocking):
- `overPerPlayerMax` counts all `CtfScoreEvent` rows for the (user,challenge) including capped/over-cap claims (the claim writes before the cap check). Effect is more-restrictive/fail-safe, never a double-award; covered by the perPlayerMax test.
- `perPlayerMax` enforcement runs after the once-per-window claim, so a max-blocked attempt still writes a ledger row. Same fail-safe direction; verified indistinguishable non-solve.

---

_Verified: 2026-07-15T04:11:57Z_
_Verifier: Claude (gsd-verifier)_
