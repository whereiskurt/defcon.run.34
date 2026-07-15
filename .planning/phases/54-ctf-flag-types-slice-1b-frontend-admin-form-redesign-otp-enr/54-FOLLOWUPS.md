# Phase 54 — Deferred Follow-ups (post-deploy UAT + informational polish)

**Recorded:** 2026-07-15 (autonomous run)
**Phase status:** Code-complete, reviewed, blocker fixed. Verification = `human_needed` for the render/interaction checks below only (no code gaps). 564/55 vitest green, tsc clean on touched files, covert path byte-identical, no new runtime dependency.

## Deferred to browser/UAT (this repo has no jsdom/testing-library — inherently browser-only)

| # | Check | Why deferred | How to verify post-deploy |
|---|-------|--------------|---------------------------|
| UAT-1 | **OTP create→solve e2e round-trip** (the CR-01 fix path) | Unit tests cover `buildOtpAnswerField` parse + judge-secret parity, but not the live save→DynamoDB→`judgeSolve` verification. | In /admin, create a Rotating-OTP flag by pasting an `otpauth://` seed; then solve it with the current rolling code — expect a credited solve. |
| UAT-2 | **otp-enroll reward card render** (SC-4) | QR `<canvas>` draw + live 1s countdown/rollover are DOM/canvas — not unit-testable. | Solve a Static flag whose reward is `otp-enroll`; confirm the QR scans in an authenticator, current code + countdown tick, "Add to Authenticator" deep link works, and `nextFlag` copy shows when set. |
| UAT-3 | **Admin form create/edit visual round-trip** (SC-1/2/3) | Full browser round-trip: preset pre-fill stays editable, live preview matches `computePoints`, secrets masked & never prefilled on re-edit, limits + `unlockAfter` round-trip through save→reload. | Create + edit a Static and an OTP flag through the redesigned `CtfForm`; confirm each behavior. |

## Informational (code review IN-01/IN-02 — deliberately skipped, low priority)

- **IN-01** — the generic "keep existing" hint (`hasEffect`) shows for any effect kind, implying an OTP reward exists even when the stored effect is a different kind. Fix needs a redaction-safe `effectKind` hint plumbed through the `redactCtfSecrets` boundary. Non-trivial; deferred.
- **IN-02** — live preview shows `First solve = 0` when `Max solves` is blank. Faithful to what the judge would actually award (arguably correct/deliberate), reads as broken. Cosmetic; deferred.

## Notes
- WR-03 from Phase 53 (server TOTP hard-coded SHA1) remains deferred; the client now honors `algorithm` (SHA1/256/512) additively, server stays SHA1-only until WR-03 lands.
- These items do not block Slices 2/3 (Phases 55/56), which are additive and independently testable.
