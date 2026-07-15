---
phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
plan: 02
subsystem: ctf
tags: [totp, rfc6238, rfc4226, crypto, timing-safe, base32, vitest, tdd]

# Dependency graph
requires:
  - phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
    provides: "otp field shape ({secret, digits, period:120, algorithm, skew}) on the Ctf entity (53-01)"
provides:
  - "Pure ctf-otp.ts TOTP core: parseOtpauth, totpAt, adjacentCodes, verifyTotp (+ _constantTimeEqual seam)"
  - "verifyTotp — NEW +/- skew, length-guarded crypto.timingSafeEqual, never-throws answer-type dispatch target for the judge (53-03)"
  - "Hand-written RFC 4648 base32 decoder (Node has no built-in) matching the Go's uppercase-normalize + =-pad-to-8"
affects: [53-03-judge-gates, 53-04-effect-plumbing, ctf-judge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure crypto module: imports ONLY node:crypto — no ElectroDB, no DOM, no new package; unit-testable in full isolation"
    - "Independent test oracle: RFC 6238 vectors + period-120 pins reproduced with a Python hmac oracle so assertions do not circularly depend on the TS impl"
    - "Length-guarded constant-time compare seam (_constantTimeEqual) reused across every skew candidate; results OR'd, no early return"
    - "Documented algorithm switch (SHA1 wired, SHA256/512 seam) mirroring the Go core"

key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-otp.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-otp.test.ts
  modified: []

key-decisions:
  - "verifyTotp takes `now` as unix SECONDS (a number), matching totpAt — keeps the whole module deterministic/testable and free of Date/ms ambiguity"
  - "Exported an underscore-prefixed _constantTimeEqual as the unit-testable constant-time seam, rather than spying on a bound crypto import (brittle across ESM)"
  - "verifyTotp OR's every skew offset (no short-circuit) so compare cost does not reveal which offset matched; returns false on any decode error (indistinguishable non-match)"

patterns-established:
  - "TOTP verify built over generation (totpAt) across a bounded +/- skew window — the Go had generation only"

requirements-completed: [CTFT-02]

coverage:
  - id: D1
    description: "totpAt matches RFC 6238 SHA1 vectors when parameterized to the RFC's 30s / 8-digit params"
    requirement: "CTFT-02"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-otp.test.ts#totpAt — RFC 6238 vectors (6 vectors)"
        status: pass
    human_judgment: false
  - id: D2
    description: "totpAt at period 120 / 6 digits returns a stable pinned code + normalizes lowercase/spaced secrets like the Go core"
    requirement: "CTFT-02"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-otp.test.ts#totpAt — period 120 / 6 digits"
        status: pass
    human_judgment: false
  - id: D3
    description: "verifyTotp accepts prev/current/next within skew=1, rejects two-away, rejects wrong-length/non-numeric/undecodable without throwing; compares constant-time (SC-2)"
    requirement: "CTFT-02"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-otp.test.ts#verifyTotp + _constantTimeEqual"
        status: pass
    human_judgment: false
  - id: D4
    description: "parseOtpauth parses otpauth:// with defaults (digits 6, period 120, SHA1, issuer Defcon.run); rejects non-otpauth scheme / missing secret; adjacentCodes returns prev/current/next + remainingSeconds in [1, period]"
    requirement: "CTFT-02"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-otp.test.ts#parseOtpauth + adjacentCodes"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-15
status: complete
---

# Phase 53 Plan 02: ctf-otp.ts — TOTP Core + Verify/Skew Summary

**Ported the RFC 6238/4226 TOTP core from the upstream meshtk Go into a pure, `node:crypto`-only `ctf-otp.ts` (base32 decode, `totpAt`, `adjacentCodes`, `parseOtpauth`) and added the NEW `verifyTotp` — a `±skew` window OR'd through a length-guarded `crypto.timingSafeEqual` — proven against RFC 6238 vectors via an independent Python oracle (31 unit tests, SC-2 fully proven at the unit level).**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-15T03:36:50Z
- **Completed:** 2026-07-15T03:40:07Z
- **Tasks:** TDD cycle (RED → GREEN; no REFACTOR needed)
- **Files:** 2 created (implementation + test), 0 modified

## Accomplishments
- Ported the meshtk Go core (`NewOTPHandler` → `parseOtpauth`, `GenerateTOTP` → `totpAt`, `CalculateTOTPWithAdjacentPeriods` → `adjacentCodes`) into a pure TS module importing ONLY `node:crypto`. Hand-wrote an RFC 4648 base32 decoder (Node has none) matching the Go's uppercase-normalize + `=`-pad-to-8 behavior.
- Built `verifyTotp` — the NEW logic the Go lacks: generate the code for each offset in `[-skew..+skew]`, compare each against the guess with a length-guarded `crypto.timingSafeEqual`, OR the results (no short-circuit), and never throw (false on any decode error). This is the answer-type dispatch target the judge (53-03) calls for `answerType === "otp"`.
- Proved correctness against RFC 6238's SHA1 vectors (parameterized to the RFC's 30s/8-digit params) and pinned a period-120/6-digit code — all reference values reproduced with an independent Python `hmac` oracle so the assertions never circularly depend on the implementation under test. 31 tests green; `tsc --noEmit` clean for the new file; import-purity grep confirms `node:crypto` only.

## Task Commits

TDD gate sequence (RED → GREEN):

1. **RED — failing RFC 6238 / skew / parse tests** — `1ac280f5` (test)
2. **GREEN — port TOTP core + NEW verify/skew** — `5e741348` (feat)

_No REFACTOR commit: the GREEN implementation was already clean (single-responsibility helpers, documented seams). The one correctness fix (remainingSeconds boundary) was applied before the GREEN commit — see Deviations._

## Files Created/Modified
- `src/lib/ctf-otp.ts` (created) — TOTP core + verify/skew. Exports `parseOtpauth`, `totpAt`, `adjacentCodes`, `verifyTotp`, and the `_constantTimeEqual` seam. Imports only `node:crypto`. Never logs the secret or guess (D-08). SHA1 wired with a documented SHA256/512 switch seam.
- `src/lib/__tests__/ctf-otp.test.ts` (created) — 31 unit tests: RFC 6238 vectors (parameterized), period-120 pins + normalization, `verifyTotp` skew boundary (accept prev/cur/next, reject two-away, no-throw guards), `_constantTimeEqual` length-guard, `parseOtpauth` defaults/rejects/round-trip.

## Decisions Made
- **`now` as unix seconds:** `verifyTotp` and `adjacentCodes` take `now` as unix **seconds** (a number), matching `totpAt`. This keeps the entire module deterministic and testable and avoids Date/millisecond ambiguity at the judge seam.
- **`_constantTimeEqual` as the tested seam:** rather than spy on a bound `crypto` import (brittle across ESM named-import binding), the length-guarded constant-time compare is an exported underscore-prefixed helper the test asserts directly (equal/unequal/length-mismatch/empty). The source-level `crypto.timingSafeEqual` usage is additionally confirmed by the verification grep.
- **No `wordlist` literal:** the module is answer-type-agnostic (it only does TOTP); the `static | otp` union lives on the entity (53-01), so nothing here needs the deferred `wordlist` literal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `remainingSeconds` produced 0 at a period boundary**
- **Found during:** GREEN implementation (before the feat commit)
- **Issue:** An initial `period - (now % period || period)` expression collapsed to `0` when `now % period === 0` (a period boundary), violating the "in [1, period]" contract the Go core guarantees (`period` at a boundary).
- **Fix:** Simplified to the Go's `period - (now % period)`, which reads `period` at a boundary and `period - (now % period)` elsewhere — always in [1, period].
- **Files modified:** `src/lib/ctf-otp.ts` (`adjacentCodes`)
- **Verification:** `adjacentCodes` remainingSeconds test asserts `40` at the fixed timestamp and the `[1, period]` bound; green.
- **Committed in:** `5e741348` (GREEN commit — fix applied before commit)

**Total deviations:** 1 auto-fixed (1 bug, pre-commit). No scope creep.

## Threat Model Coverage
- **T-53-02-01 (timing side-channel in code compare — mitigate):** the final compare routes through the length-guarded `crypto.timingSafeEqual` seam (`_constantTimeEqual`); no `===` on the code. Verified by unit test + source grep.
- **T-53-02-03 (secret/guess in logs — mitigate):** the module performs zero logging; it never emits the secret or the guess. Verified by inspection (no `console`/logger import).
- **T-53-02-02 (replay across skew — accept):** unchanged; bounded by `perPlayerIntervalHours` at the judge (53-03); skew is intentionally small (default 1).

## Issues Encountered
- Host default Node is v22.1.0, below the vitest floor; ran all vitest/tsc under `nvm use 23.6.0` per the repo's documented Node-for-tests gotcha. No other issues.

## User Setup Required
None — pure backend crypto primitive; no UI, no new env var, no new package, no infra.

## Next Phase Readiness
- **53-03 (judge gates, wave 2):** unblocked — `verifyTotp(secret, guess, now, {digits, period, skew})` is the `answerType === "otp"` dispatch target; it accepts current ± skew, rejects outside, and never throws (a wrong/undecodable guess is an indistinguishable non-solve, preserving the covert-channel invariant).
- **53-04 (effect plumbing):** unaffected by this surface.
- No blockers.

## Self-Check: PASSED

Both created files exist on disk; both TDD gate commits (`1ac280f5` test, `5e741348` feat) are present in git log. Verification green: `ctf-otp.test.ts` (31 tests) passing under Node 23.6.0; `tsc --noEmit` clean for `ctf-otp.ts`; import-purity grep shows `node:crypto` only.

---
*Phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati*
*Completed: 2026-07-15*
