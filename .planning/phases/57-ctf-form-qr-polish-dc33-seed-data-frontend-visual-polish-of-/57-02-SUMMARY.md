---
phase: 57-ctf-form-qr-polish-dc33-seed-data
plan: 02
subsystem: run.human / CTF player-facing reward reveal (Surface B)
tags: [ctf, otp-enroll, ui-restyle, bespoke-dark, qr, accessibility]
requires:
  - "CtfOtpEnroll structure + adjacentCodesAsync/parseOtpauth (54-02/54-04)"
  - "asOtpEnrollEffect narrowing in ClaimClient (54-04)"
provides:
  - "Bespoke-dark OTP reward reveal (CTFP-02) with cyan rolling-code hero, gradient countdown bar, mint CTA, cyan chain callout"
  - "QR framing (rounded border + soft outer glow) with UNCHANGED qr.toDataURL params (CTFP-03/D2)"
  - "Optional flagName prop on CtfOtpEnroll for the '✓ Correct — {name} solved' header"
affects:
  - "apps/run.human/webapp/src/components/ctf/CtfOtpEnroll.tsx"
  - "apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx"
tech-stack:
  added: []
  patterns:
    - "Scoped bespoke-dark palette via a local const + inline style (NOT HeroUI theme tokens) so the card renders dark over either app theme"
    - "role=progressbar + aria-valuenow/aria-valuetext preserves the countdown for AT after replacing the visible 'New code in Ns' text"
key-files:
  created: []
  modified:
    - "apps/run.human/webapp/src/components/ctf/CtfOtpEnroll.tsx"
    - "apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx"
decisions:
  - "flagName omitted from ClaimClient wiring — JudgeResult carries no flag/challenge display name; header falls back to '✓ Correct' (no new judge/API field introduced, per Task 2 constraint)"
  - "Dropped the redundant 'Or tap Add to Authenticator' helper line — the full-width mint button is now the unambiguous primary; copy contract lists only primary + secondary"
  - "QR outer glow implemented as a dual mint/cyan box-shadow at ~14%/10% alpha AROUND the white quiet-zone card; quiet-zone card, <img>, and qr.toDataURL params untouched (D2)"
metrics:
  duration: ~3 min
  completed: 2026-07-15
  tasks_completed: 2 of 3 (Task 3 is a blocking human-verify, PENDING)
  files_modified: 2
status: complete
---

# Phase 57 Plan 02: Bespoke-Dark OTP Reward Reveal (Surface B) Summary

Restyled the player-facing `otp-enroll` reward reveal (`CtfOtpEnroll.tsx`) and the `ClaimClient` solved-branch success card to full self-contained bespoke-dark per the approved 57-UI-SPEC Surface B contract — cyan 40px rolling-code hero, gradient countdown bar replacing the plain "New code in Ns" line, full-width mint "＋ Add to Authenticator" CTA, and a cyan chain callout — while freezing the enrollment QR (unchanged `qr.toDataURL` params, framing-only polish) and preserving 100% of the existing OTP logic.

## What Was Built

**Task 1 — `CtfOtpEnroll.tsx` (commit f5fee6c7):**
- Self-contained dark card via a scoped local hex palette (`--card #15181d`, `1px --line #262b33` border, 14px radius, 18px padding, centered `max-w-[380px]`), applied through inline `style` so it renders dark over EITHER app theme (does not depend on HeroUI theme tokens).
- Header replaced with "✓ Correct — {name} solved" in mint via a NEW optional `flagName?` prop; falls back to "✓ Correct" when absent (display copy only — no behavior change).
- QR: `qr.toDataURL(otpauth, { width:220, margin:2, errorCorrectionLevel:"M", color:{ light:"#ffffff", dark:"#000000" } })` and the white quiet-zone card (`bg-white p-2`, `min-h/min-w-[220px]`, `<img>` 200×200) UNCHANGED; added only a rounded border + a soft OUTER mint/cyan glow box-shadow around the white frame. Modules/pupils untouched (CTFP-03/D2).
- Rolling-code hero: `codes.current` promoted to mono 40px/700 cyan tabular-nums, `letter-spacing:.12em`, flanked by prev/next (12px muted, from existing `codes.previous`/`codes.next`). `aria-live="polite"` roll announcement + `aria-hidden` on decorative code/label spans preserved.
- Countdown: the "New code in {remaining}s" text line REPLACED by a 6px `rounded-full` bar — track `--line2 #333a44`, fill `linear-gradient(90deg,#38bdf8,#4ade80)`, `width = (remaining/period)*100%` (clamped) driven purely off the EXISTING `remaining` state + parsed `period` — no new timer/interval. Given `role="progressbar"` + `aria-valuemin/max/now` and `aria-valuetext="New code in {remaining} seconds"` so the countdown stays available to AT.
- Actions: full-width mint primary "＋ Add to Authenticator" (border `--mint`, bg `rgba(74,222,128,.14)`, text `--mint`, `href` = raw `otpauth://`) + neutral secondary "Copy setup link" (ghost `--line` border, `--muted` text, existing copy→"Copied" transient).
- Chain callout "🔗 This unlocks: {nextFlag}" — cyan text on `rgba(56,189,248,.07)` fill / `rgba(56,189,248,.25)` border, radius 8px, `{nextFlag}` in mono, rendered ONLY when `nextFlag` present (unchanged conditional).
- Preserved verbatim: `parseOtpauth`, the `if (!parsed) return null` no-op, the `isSupportedAlgorithm` gate + WR-02 fallback note (restyled to `--muted`, copy unchanged), and `adjacentCodesAsync`.

**Task 2 — `ClaimClient.tsx` (commit 94007148):**
- Grouped the credited-solve celebration header (`Trophy`, "Flag captured!", first-blood `Chip`, `+{points}`, ordinal) into one tightened cluster (gap-2), with `+{points}`/ordinal as a tight stat unit; `+{points}` stays `text-primary` bold display.
- Centered the self-contained dark reward reveal under the header (`w-full flex justify-center pt-1`) so it frames cleanly.
- `flagName` intentionally omitted (JudgeResult has no name field) → CtfOtpEnroll falls back to "✓ Correct"; no new judge/API field introduced.
- `asOtpEnrollEffect` narrowing, capped/not-solved/signin branches, and the nonce cookie effects all unchanged.

## Verification

- `ctf-otp-enroll.test.ts` (9) + `ctf-otp-client.test.ts` (44) — 53 tests PASS (Node 23.6.0).
- `tsc --noEmit`: ZERO errors in `CtfOtpEnroll.tsx` / `ClaimClient.tsx`. (5 pre-existing project-wide errors in untouched files — see Deferred Issues.)

## Pending Blocking Checkpoint (Task 3 — human-verify, ship gate)

**Type:** checkpoint:human-verify (gate=blocking) — CANNOT be automated; left for the orchestrator to route to the human.

**Status:** PENDING. Both code tasks are complete and automated checks are green, but the CTFP-03/D2 HARD ship gate requires a human:

1. From `apps/run.human/webapp`, `PORT=3001 npm run dev`; trigger a credited otp-enroll solve so the reveal card renders (e.g. the goldstein → goldstein-otp path, or the admin reveal-preview inside CtfForm).
2. Confirm the reveal card renders full-dark and legible even when the app is in LIGHT theme (D1 risk); current code is a large cyan hero; the countdown bar shrinks smoothly as the period ticks.
3. **QR SCAN GATE (HARD):** scan the rendered enrollment QR with a REAL Google Authenticator / Authy install. Confirm it enrolls and produces a working rolling 6-digit code matching the on-screen current code. If it does NOT scan/enroll, the framing regressed the modules — stop and fix.

**Resume signal:** "approved" once the QR enrolls in a real authenticator and the dark card is legible over a light theme; otherwise describe the failure.

## Deviations from Plan

None affecting logic. Two scoped restyle decisions (both within the plan's latitude):
- **flagName omitted in ClaimClient** — the plan explicitly instructs to wire `flagName` only from an existing `result` value and otherwise omit it; `JudgeResult` has no name field, so it is omitted (fallback "✓ Correct"). Not a deviation — the documented fallback path.
- **Dropped redundant "Or tap Add to Authenticator" helper line** in the actions block — the new full-width mint button is the unambiguous primary and the copy contract lists only primary + secondary CTAs. Copy-only, no behavior change.

## Deferred Issues (pre-existing, out of scope)

5 pre-existing `tsc --noEmit` errors in files untouched by this plan (present on the base commit before this work):
- `src/components/header/dropdown-user.tsx:34` — `Cannot find module '@public/header/dcjack.svg'` (svg module typing).
- `src/entities/__tests__/checkin.test.ts:119–122` — ElectroDB `Property 'model' does not exist on type 'Entity<...>'` (test typing).

Not caused by and unrelated to the Surface B restyle; logged here per the executor scope boundary.

## Threat Surface

No new security-relevant surface introduced. The one high-severity item (T-57B-01, enrollment QR modules) is mitigated by freezing `qr.toDataURL` params (framing-only) + the pending blocking real-authenticator scan gate. No new endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- Files exist: `CtfOtpEnroll.tsx`, `ClaimClient.tsx`, `57-02-SUMMARY.md` — all FOUND.
- Commits exist: f5fee6c7, 94007148 — all FOUND.
