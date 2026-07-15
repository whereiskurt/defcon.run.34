# Phase 57 — Deferred follow-ups

Captured 2026-07-15 at ship time. None block Phase 57 (restyle + seed).

## From code review (out of restyle scope — pre-existing)
- **WR-03** — `CtfForm` create-path lets an admin save an `answerType:"otp"` flag with a BLANK `otp.secret` → silently unsolvable. Pre-existing form/judge-validation gap (the existing CR-01 guard covers edit, not create). Fix: create-only guard in `onSave` (REVIEW.md lines ~121-128).
- **IN-01** — `ClaimClient` sets the `ctf_pending` cookie without `SameSite`/`Secure`. Pre-existing ported behavior; low-risk nonce.
- **IN-03** — `seed-ctf.mts` hardcodes the ElectroDB `Ctf` key format (`$run#challenge_<name>` / `$ctf_1`). Covered by `qr-key-parity.test.ts`; optional DRY-RUN drift-assert.

## Human-verify ship gates (Phase 57 — blocking before merge/deploy)
- **57-01** — eyeball the admin CTF form in BOTH light and dark themes: segment glow, two-line type descriptors, stat-tile scoring preview, amber window note; confirm no raw mockup darks leaked into Surface A. (auth-gated /admin/qr/ctf)
- **57-02** — scan the restyled enrollment QR in a REAL authenticator (Google Authenticator / Authy) and confirm it enrolls a working rolling code; check dark-card legibility over a light-theme device.

## Seed data sanity (before enabling starters in prod)
- Confirm the `grace-hopper` timed-drop tier window (DEF CON 34: 2026-08-06 → 2026-08-10) matches the live event wall-clock before enabling that starter (award is 100 outside the window / 500 inside).
- Prod seed run is a gated operator step: DRY-RUN first to confirm pk/sk parity, then `AWS_PROFILE=dc34-application` + prod `CTF_ANSWER_SALT`, no localhost `.env`, then `--confirm`.
