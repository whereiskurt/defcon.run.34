---
phase: 33-oidc-silent-sso
plan: 05
subsystem: auth
tags: [oidc, next-auth, silent-sso, parity, vitest, unit-test, prompt-none, postmessage, anti-spoof]

# Dependency graph
requires:
  - phase: 33-oidc-silent-sso (plan 03)
    provides: "Byte-identical silent-SSO 5-file unit present in gpx/flash/bib (shared SHA-256 baseline for the parity guard)"
provides:
  - "Parity regression test (run.bib vitest, node env) that fails and names the divergent file if any of the 5 silent-SSO unit files drifts across gpx/flash/bib"
  - "Pure-logic unit tests pinning resolveSilentStatus (success on error-ABSENCE, login_required on every next-auth error param / bare OIDC negative), decideParentAction (foreign-origin→ignore anti-spoof gate + type gate + success/login_required mapping), and the SILENT_SSO_TIMEOUT_MS 4-5s window"
affects: [33-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parity enforced as a node:fs test reading the 5 unit files from all three webapp roots and asserting byte-equality vs canonical run.gpx — no snapshot, no hashing dep"
    - "Security invariants (origin gate, negative normalization) encoded as regressions in run.bib's EXISTING node-env vitest; testing bib's copy == testing all three because parity guarantees identity"

key-files:
  created:
    - apps/run.bib/webapp/src/__tests__/silent-sso-parity.test.ts
    - apps/run.bib/webapp/src/__tests__/silent-sso-unit.test.ts
  modified:
    - .planning/ROADMAP.md
    - .planning/STATE.md

key-decisions:
  - "Parity test reads the five unit files from each webapp root via node:fs and asserts flash/bib === canonical gpx byte-for-byte (5 files → 5 assertions); drift-detection was proven live by a temporary one-char mutation that turned the suite red, then reverted."
  - "resolveSilentStatus success is asserted from error-free / param-less input (and explicitly from a `code`-only param to prove success is NOT keyed on `code`); login_required asserted for the four named OIDC negatives via `error=`, for arbitrary next-auth@5 error codes (AccessDenied/Configuration/Verification), and for bare OIDC-negative keys — matching the source's `params.has('error')` + OIDC_NEGATIVE_PARAMS contract."
  - "decideParentAction tests pin the foreign-origin→ignore anti-spoof invariant (T-33-10) and the type gate, plus null/non-object data guards, then success→authenticated and login_required→stay-logged-out."

patterns-established:
  - "The parity test is the continuous CI enforcement of the 'authored once, placed identically' delivery constraint (T-33-08b)."

requirements-completed: [SSO-05, SSO-07]

coverage:
  - id: C1
    description: "Parity test fails on any drift of the 5 unit files across gpx/flash/bib"
    requirement: "SSO-05"
    verification:
      - kind: unit
        ref: "silent-sso-parity.test.ts — 5 passed green; temporary one-char mutation of run.flash lib/silent-sso.ts turned it red naming the divergent file, then reverted"
        status: pass
    human_judgment: false
  - id: C2
    description: "resolveSilentStatus: success on error-absence (not code), login_required on every error/negative"
    requirement: "SSO-07"
    verification:
      - kind: unit
        ref: "silent-sso-unit.test.ts — param-less & code-only & benign-param → success; error=login_required/interaction_required/consent_required/access_denied, error=AccessDenied/Configuration/Verification, and bare OIDC-negative keys → login_required"
        status: pass
    human_judgment: false
  - id: C3
    description: "decideParentAction same-origin anti-spoof gate + type gate + status mapping"
    requirement: "SSO-07"
    verification:
      - kind: unit
        ref: "silent-sso-unit.test.ts — foreign origin→ignore, wrong type→ignore, null/non-object→ignore, success→authenticated, login_required→stay-logged-out"
        status: pass
    human_judgment: false
  - id: C4
    description: "SILENT_SSO_TIMEOUT_MS within the ~4-5s window"
    requirement: "SSO-07"
    verification:
      - kind: unit
        ref: "silent-sso-unit.test.ts — asserts number in [4000,5000] (actual 4500)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-04
status: complete
---

# Phase 33 Plan 05: Silent-SSO Parity + Pure-Logic Unit Tests Summary

**Added a node:fs parity test that fails (naming the divergent file) if any of the five silent-SSO unit files drifts across run.gpx/run.flash/run.bib, plus pure-logic unit tests pinning `resolveSilentStatus` (success on the ABSENCE of the next-auth error param — never on a `code` param — and login_required on every error/OIDC-negative), `decideParentAction`'s foreign-origin→ignore anti-spoof gate, and the 4.5s timeout window — all 25 tests green in run.bib's existing node-env vitest, no new package anywhere.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-04
- **Completed:** 2026-07-04
- **Tasks:** 2
- **Files created:** 2 (both test files)

## Accomplishments
- **Parity guard (Task 1):** `silent-sso-parity.test.ts` resolves the three webapp roots relative to the test file (climbs to the monorepo `apps/` dir), reads each of the five unit files (`lib/silent-sso.ts`, `api/auth/silent-signin/route.ts`, `api/auth/auto-signin/route.ts`, `silent-callback/page.tsx`, `components/SilentSSO.tsx`) from run.gpx (canonical), run.flash, and run.bib via `node:fs`, and asserts flash/bib equal gpx byte-for-byte. 5 files → 5 passing assertions.
- **Drift detection proven:** temporarily appended one line to run.flash's `lib/silent-sso.ts` — the suite failed with `Silent-SSO unit drift: run.flash/src/lib/silent-sso.ts differs from canonical run.gpx/...`, then reverted (working tree clean).
- **Logic tests (Task 2):** `silent-sso-unit.test.ts` imports the helpers via the `@` alias from `@/lib/silent-sso` and covers the exact implemented contract read from source:
  - `resolveSilentStatus` → **success** for a param-less landing, a benign non-error param, and even a `code`-only param (explicitly proving success is NOT keyed on `code`, since next-auth already consumed the code at its own callback).
  - `resolveSilentStatus` → **login_required** for `error=login_required|interaction_required|consent_required|access_denied`, for arbitrary next-auth@5 error codes (`error=AccessDenied|Configuration|Verification` — the helper keys on `params.has('error')`), and for the four bare OIDC-negative keys (the source's defensive `OIDC_NEGATIVE_PARAMS` loop).
  - `decideParentAction` → **ignore** for a well-formed message from a foreign origin (anti-spoof invariant T-33-10), ignore for same-origin wrong-type and for null/non-object data; **authenticated** for same-origin success; **stay-logged-out** for same-origin login_required.
  - `SILENT_SSO_TIMEOUT_MS` asserted to be a number within [4000, 5000] (actual 4500).
- **Ran green under the required Node:** both suites executed under Node 23.6.0 (via nvm, per the prior-wave env note) in run.bib's vitest ^4.1.9 — `Test Files 2 passed (2) · Tests 25 passed (25)`.

## Task Commits

1. **Task 1: parity test guards byte-identical silent-SSO unit across gpx/flash/bib** — `a872d090` (test)
2. **Task 2: unit tests for resolveSilentStatus / decideParentAction / timeout** — `cd3fb71a` (test)

## Files Created/Modified
- `apps/run.bib/webapp/src/__tests__/silent-sso-parity.test.ts` — node:fs parity guard over the 5-file unit across the three webapp roots.
- `apps/run.bib/webapp/src/__tests__/silent-sso-unit.test.ts` — pure-logic tests for `resolveSilentStatus`, `decideParentAction`, and the timeout constant.
- `.planning/ROADMAP.md` — 33-05 plan checkbox marked complete.
- `.planning/STATE.md` — position advanced to Plan 6 of 6; 33-05 decision recorded.

## Decisions Made
- **Parity via byte-equality read, not a hash snapshot.** Reading the actual file contents and asserting string equality gives a self-describing failure that names the exact divergent file/app, and needs no crypto/snapshot dependency — reusing bib's existing node-env vitest exactly as the plan's `key_links` require (threat T-33-SC stays "accept": no package installed).
- **Success asserted from error-absence, with a code-only negative control.** The tests encode the source's real contract (`resolveSilentStatus` returns success unless an `error` param or a bare OIDC-negative key is present) and add a `code=xyz` case that still resolves to success — proving success is not gated on `code`, which would misclassify every real next-auth success.
- **Anti-spoof gate pinned first.** `decideParentAction`'s foreign-origin→ignore case is asserted with an otherwise-valid message, so a future edit that drops the origin check fails CI (T-33-10).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran the vitest gates under Node 23.6.0 via nvm**
- **Found during:** Task 1 and Task 2 verify gates.
- **Issue:** The default shell Node was v22.1.0; vitest 4 in these webapps needs Node ≥22.12/23 (repo standard is 23.6.0 via nvm, per the prior-wave env note and 33-03-SUMMARY).
- **Fix:** Sourced nvm and `nvm use 23.6.0` in the verify shells only. run.bib's `node_modules` was already present (no `npm ci` needed). No package added, no lockfile change.
- **Files modified:** none tracked.
- **Verification:** both suites ran green under `node v23.6.0`.

---

**Total deviations:** 1 (Node version selection for the verify gate; no code/scope change).
**Impact on plan:** None on scope — the deviation only satisfied the runtime prerequisite for the plan's own `npx vitest run` gates.

## Threat Surface Scan
No new security-relevant surface introduced — this plan adds only test files. The two threats it is designed to mitigate (T-33-10 origin-gate regression, T-33-08b copy drift) are now guarded by executable regressions; T-33-SC (package installs) stays accepted (no package added).

## Known Stubs
None. Both test files exercise the live helpers and real on-disk unit files; no placeholder/mock data paths.

## Issues Encountered
None beyond the Node-version deviation above. All 25 assertions pass; drift detection verified and reverted; working tree clean.

## Next Phase Readiness
- SSO-05 (parity) and SSO-07 (RP pure-logic unit) are now covered by green CI-runnable tests in run.bib.
- Remaining: 33-06 — e2e Playwright (full on gpx, smoke on flash + bib) for the warm-session invisible-iframe path (SSO-08).

## Self-Check: PASSED

Both test files present on disk; both task commits (`a872d090`, `cd3fb71a`) present in git history; both suites green (25/25) under Node 23.6.0; drift-detection property verified via reverted mutation.

---
*Phase: 33-oidc-silent-sso*
*Completed: 2026-07-04*
