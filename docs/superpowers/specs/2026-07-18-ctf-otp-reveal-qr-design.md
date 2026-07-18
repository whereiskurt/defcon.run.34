# CTF admin — reveal OTP secret + enrollment QR

**Date:** 2026-07-18
**Surface:** run.human `/admin/qr/ctf/[challenge]` edit form, Rotating-OTP answer type.

## Problem

The CTF challenge editor stores a rotating-OTP flag's shared TOTP secret recoverably
(`Ctf.otp.secret`, base32 — the judge needs it to compute codes), but the edit page
deliberately strips it via `redactCtfSecrets` so it is *"never shown again after you
save."* An admin who needs to re-share the enrollment seed (hand a runner the QR /
setup link, or verify the current code) has no way to see it again short of a DB read.

## Goal

Let a CTF admin **reveal on demand** an existing flag's OTP secret and render its
enrollment QR (`otpauth://` URI) for authenticator apps — without weakening the
default posture (secret stays out of the page's initial render).

## Scope

- **OTP answer type only.** Static and Wordlist answers are one-way hashes — there is
  no plaintext to reveal, so this feature does not touch them.
- Reveal is **on demand**: hidden by default, shown only after a deliberate click that
  makes a separately-gated server round-trip. The secret is never in the page HTML.
- Write path is **unchanged**. This is read-only exposure of an already-stored secret.

## Design

### 1. `buildOtpauth()` — pure helper (`lib/ctf-otp-core.ts`)

Inverse of the existing `parseOtpauth`. Takes `{ secret, digits?, period?, algorithm?,
label?, issuer? }`, applies the meshtk defaults (6 / 120 / SHA1 / issuer "Defcon.run"),
returns a canonical `otpauth://totp/<issuer>:<label>?secret=…&issuer=…&algorithm=…&digits=…&period=…`.
Node-free so it bundles into the client. Verified by a round-trip test against
`parseOtpauth`. (The stored `otp` map carries no label/issuer, so reveal reconstructs
the label from the challenge name + default issuer — cosmetic only; TOTP verification
depends solely on secret/digits/period/algorithm.)

### 2. `revealCtfOtp()` + `ctf_otp_reveal` action (`lib/qr-admin.ts`, `api/admin/qr/route.ts`)

New server reader `revealCtfOtp(challenge)` reads the full row via `getCtf`, and — only
if `otp.secret` is present — returns `{ secret, otpauth, digits, period, algorithm }`.
Exposed through a new `ctf_otp_reveal { challenge }` action on the existing
`/api/admin/qr` route, reusing that route's admin gate verbatim (every denial → 404,
per the non-disclosure contract). Returns 404 when there is no secret. `redactCtfSecrets`
is untouched — the default edit-page payload still ships redacted.

### 3. Reveal UI (`components/admin/CtfForm.tsx`, Rotating-OTP branch)

Shown only when `isEdit && hasOtpSecret`. A **"Reveal secret"** button →
`postQrAction({ action: "ctf_otp_reveal", challenge })`. On success, an inset panel
renders:
- the base32 secret in monospace + **Copy**,
- the full `otpauth://` URI + **Copy**,
- the enrollment **QR**, rendered client-side via `qr.toDataURL(otpauth, …)` (the exact
  frozen params `CtfOtpEnroll` already uses, dark modules on a white quiet-zone),
- a caveat caption: *Google Authenticator ignores the period and assumes 30s — use a
  period-aware app (Aegis, 2FAS, FreeOTP) for non-30s flags.*

A **Hide** toggle clears the panel (and drops the secret from client state). The
existing "never shown again after you save" helper copy is corrected to point at the
Reveal control.

## Non-goals

- No rolling-code live display in the admin panel (kept to secret + QR + link).
- No change to Static/Wordlist. No change to the write/redaction path.

## Security note

This intentionally exposes a shared secret to any user who already passes the CTF-admin
gate (`admin | runadmin`, live-revalidated). That is the same trust boundary that can
already edit/delete every challenge. Keeping it reveal-on-demand (not in initial HTML)
preserves the original anti-shoulder-surf/screenshot instinct.
