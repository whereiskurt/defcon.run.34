---
phase: 54-ctf-flag-types-slice-1b-frontend-admin-form-redesign-otp-enr
verified: 2026-07-15T09:35:00Z
status: human_needed
score: 4/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "SC-4 — otp-enroll renderer draws a scannable QR, shows the correct current code with a live countdown + adjacent codes, exposes an Add-to-Authenticator deep link, and names effect.nextFlag when present"
    test: "Trigger a real non-covert solve whose JudgeResult.effect is {kind:'otp-enroll', otpauth, nextFlag}. In the browser, scan the rendered QR into an authenticator app and confirm the app-generated code equals the on-screen CURRENT code; watch the 'New code in Ns' countdown tick down and the code roll at period boundary; tap 'Add to Authenticator' and confirm the otpauth:// deep link opens; confirm the 'This unlocks: {nextFlag}' line shows when nextFlag is present."
    why_human: "QR canvas rasterization (qrcode.toDataURL → <img>), the 1s setInterval countdown, and adjacent-code rollover are DOM/runtime behaviors. This repo has no jsdom/testing-library, so component render cannot be exercised by a test. All non-visual logic (asOtpEnrollEffect narrowing, adjacentCodesAsync parity vs the shipped sync path, parseOtpauth, the otpauth href) IS unit-tested and present + wired."
human_verification:
  - test: "In a browser, open /admin/qr/ctf/<challenge> for both a Static and a Rotating-OTP flag. Pick a challenge-type preset (e.g. First-blood race) and confirm the Advanced-drawer knobs visibly pre-fill AND remain editable after the preset is applied. Re-edit an existing flag and confirm the Answer / OTP-secret / reward-otpauth fields are blank (masked placeholder), and that saving with them blank keeps the stored values. Set per-24h interval / per-player max / global max / unlockAfter, save, reload, and confirm they round-trip."
    expected: "Both flag types author end-to-end; presets pre-fill editable knobs; secrets never prefilled but preserved on blank-save; limits + unlock round-trip. Live scoring preview matches expectation."
    why_human: "Full interactive form render + round-trip through save→DynamoDB→reload is browser/integration behavior; no jsdom in this repo. Underlying logic (presetToAdvanced, previewPoints parity, inference, redactCtfSecrets, onSave payload) is unit-tested and the JSX sections are present + wired."
  - test: "SC-4 visual — see behavior_unverified_items above (QR scan + live countdown + Add-to-Authenticator deep link + nextFlag line on a real otp-enroll solve)."
    expected: "Scannable QR resolves in an authenticator; on-screen CURRENT code matches; countdown ticks + rolls; deep link opens; nextFlag shown when present."
    why_human: "Browser-only canvas render + timer; not exercisable without jsdom."
---

# Phase 54: CTF Flag Types — Slice 1b Frontend Verification Report

**Phase Goal:** Ship the run.human UI half of the CTF flag-types milestone on top of Phase 53's backend — a restructured design-A `CtfForm.tsx` (answer-type framework, Static→OTP-enrollment reward configurator, limits, unlock/chaining, editable Advanced drawer, live scoring preview, dead `Points` field removed, write-only secrets) plus a new client `otp-enroll` reward renderer wired to the non-covert solve response — with the covert CSS path untouched and no new runtime dependency.
**Verified:** 2026-07-15
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|-----------------------------------|--------|----------|
| SC-1 | Admin can create/edit a Static and a Rotating-OTP flag through the redesigned form; a preset pre-fills the Advanced scoring knobs, and knobs remain editable after a preset is applied | ✓ VERIFIED | `CtfForm.tsx` renders all 7 ordered sections (Name / Challenge-type `role=radiogroup` presets / Answer type `[static, otp]` / Scoring window & limits / Unlock & chaining / Advanced drawer / Live preview). `applyPreset(id)` (line 206) writes `presetToAdvanced(id)` into the string knob-state; Advanced knobs are never `disabled` (stay editable). `presetToAdvanced` + `inferChallengeType` round-trip proven by 19 `ctf-form-model.test.ts` tests. Both answer segments present (Static 3a / Rotating OTP 3b); Wordlist correctly not rendered. Full browser create/edit round-trip routed to human. |
| SC-2 | The Static Reward→OTP-enrollment control configures the seed + shows a reveal preview; the dead `Points` field is gone; answers/secrets are masked and never prefilled on edit | ✓ VERIFIED | `grep -c setPoints CtfForm.tsx` → 0 (dead field removed, `onSave` no longer sends `points`). `answer`/`otpSecret`/`rewardOtpauth` all `useState("")` — never seeded from `initial` (lines 121-122, 176). Reward configurator (3a) composes `{kind:"otp-enroll", otpauth, nextFlag?}` in `onSave` (line 226); Reveal preview (line 446) reuses `<CtfOtpEnroll>`. `redactCtfSecrets` (server, tested) strips `otp.secret` + `effect`; edit page wired through it. |
| SC-3 | The live scoring preview matches `computePoints`; per-24h / perPlayerMax / globalMax / unlockAfter are settable and round-trip through save/edit | ✓ VERIFIED | Section 7 calls `previewPoints(previewConfig, n)` (lines 784-785), the tested adapter that delegates to `computePoints` — parity proven by a config×n table in `ctf-form-model.test.ts` (first-blood, floor, over-cap⇒0, active tier). Limits read from `initial?.perPlayerIntervalHours/perPlayerMax/globalMax/unlockAfter` (lines 157-170) and are sent back via `numOrUndef` in `onSave` (lines 260-263) — round-trip wiring present. (Live save→reload confirm is in the human checklist.) |
| SC-4 | On a non-covert solve carrying `effect.kind==="otp-enroll"`, the renderer draws a scannable QR, shows the correct current code with live countdown + adjacent codes, exposes an Add-to-Authenticator deep link, and names `effect.nextFlag` when present | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Dispatch wired: `ClaimClient` narrows `result.effect` via `asOtpEnrollEffect` inside the `solved && points>0` branch and renders `<CtfOtpEnroll otpauth nextFlag>`. `CtfOtpEnroll.tsx` is fully implemented: `qr.toDataURL` QR, `adjacentCodesAsync` rolling code (parity-tested vs sync path + RFC-6238 anchor), self-correcting 1s countdown, `<a href={otpauth}>` deep link, conditional nextFlag line. Narrowing + no-op-on-malformed proven by 9 tests. QR pixel render + live countdown ticking are browser-only (no jsdom) → routed to human. |
| SC-5 | Covert CSS path (`covert-egg.ts`) untouched, byte-identical; no new runtime dependency; phase tests cover preset→Advanced, preview-vs-computePoints, masked-secret non-prefill, and otp-enroll render | ✓ VERIFIED | `git diff --stat b3944c11..HEAD` over all 5 covert modules (covert-egg.ts, EggTrigger.tsx, CtfCelebration.tsx, ctf-covert-css.ts, (ctf)/assets/theme/route.ts) → empty. `git diff b3944c11..HEAD -- package.json` → empty; `qrcode@^1.5.4` already present. `ctf-reward-covert-invariant.test.ts` (6 tests) disk-reads covert modules and asserts none contain reward tokens. All 4 obligation test groups present + green. |

**Score:** 4/5 truths verified (1 present, behavior-unverified — SC-4 visual render)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/admin/ctf-form-model.ts` | Pure model seam (presets/preview/inference/redaction) | ✓ VERIFIED | 310 lines, no `"use client"`, imports only `@/lib/ctf-scoring`; all 6 exports substantive; 19 tests green |
| `src/lib/ctf-otp-core.ts` | Node-free TOTP primitives | ✓ VERIFIED | 160 lines; grep for `node:crypto`/`Buffer.` → none; re-exported by ctf-otp.ts |
| `src/lib/ctf-otp-client.ts` | `adjacentCodesAsync` via Web Crypto | ✓ VERIFIED | Uses `globalThis.crypto.subtle`; no node import, no node-backed ctf-otp import; parity-tested |
| `src/lib/ctf-otp.ts` | Phase-53 contract preserved | ✓ VERIFIED | Still exports `parseOtpauth`, `totpAt`, `adjacentCodes`, `verifyTotp`; ctf-otp.test.ts green with zero edits |
| `src/lib/ctf-otp-enroll.ts` | `asOtpEnrollEffect` narrowing gate | ✓ VERIFIED | 66 lines; type-only ctf-judge import; try/catch parseOtpauth; never throws; 9 tests |
| `src/components/ctf/CtfOtpEnroll.tsx` | otp-enroll reward card | ✓ VERIFIED | 192 lines; QR + rolling code + countdown + deep link + copy + nextFlag; imports only core+client crypto |
| `src/app/(ctf)/ctf/claim/ClaimClient.tsx` | Non-covert reward dispatch | ✓ VERIFIED | +9 lines; renders reward only in `solved && points>0` branch |
| `src/app/(protected)/admin/qr/ctf/[challenge]/page.tsx` | Redaction-wired edit page | ✓ VERIFIED | Raw `record as CtfRecord` cast removed; now `redactCtfSecrets(record as LoadedCtfRecord)` |
| `src/components/admin/CtfForm.tsx` | Design-A redesign | ✓ VERIFIED | +508/-187; 7 sections, presets, limits, unlock, advanced drawer, live preview, reward configurator; Points removed |
| `src/components/admin/qr-ui.ts` | Shared segmented/reward tokens | ✓ VERIFIED | +13 lines: cls.segment/segmentActive/segmentIdle/chip/rewardCard |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| CtfForm.tsx | ctf-form-model.ts | imports presetToAdvanced/previewPoints/inferChallengeType/inferAnswerType | ✓ WIRED |
| CtfForm.tsx | CtfOtpEnroll.tsx | reveal preview reuses the renderer (line 446) | ✓ WIRED |
| edit page | redactCtfSecrets | `redactCtfSecrets(record as LoadedCtfRecord)` before client prop | ✓ WIRED |
| ClaimClient.tsx | asOtpEnrollEffect + CtfOtpEnroll | narrow `result.effect`, render on non-covert solve | ✓ WIRED |
| CtfOtpEnroll.tsx | ctf-otp-client.ts / ctf-otp-core.ts / qrcode | adjacentCodesAsync + parseOtpauth + qr.toDataURL | ✓ WIRED |
| ctf-form-model.ts | ctf-scoring.ts (NOT ctf-judge) | previewPoints imports computePoints from client-safe scorer | ✓ WIRED (grep ctf-judge → none) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full webapp suite | `npx vitest run` (Node 23.6.0) | 551 passed (55 files) | ✓ PASS |
| Covert byte-identical | `git diff --stat b3944c11..HEAD` (5 covert modules) | empty | ✓ PASS |
| No new dependency | `git diff b3944c11..HEAD -- package.json` | empty; qrcode@^1.5.4 present | ✓ PASS |
| Dead Points field removed | `grep -c setPoints CtfForm.tsx` | 0 | ✓ PASS |
| No server judge import in client model | `grep -n ctf-judge ctf-form-model.ts` | none | ✓ PASS |
| Client OTP node-free | `grep -nE 'node:crypto|Buffer.' ctf-otp-core.ts ctf-otp-client.ts` | none | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTFT-07 | 54-01, 54-04 | CtfForm design-A redesign, presets, limits, unlock, advanced drawer, live preview, remove Points, write-only secrets | ✓ SATISFIED (logic + structure); visual render → human | ctf-form-model tests + CtfForm sections + redaction wiring |
| CTFT-08 | 54-02, 54-03 | Client otp-enroll reward renderer (QR + rolling code + deep link + nextFlag), no new dep, covert unaffected | ✓ SATISFIED (logic + wiring); visual QR/countdown → human | asOtpEnrollEffect + adjacentCodesAsync parity + covert-invariant tests |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| CtfForm.tsx | 543-549 | Informational "Day/time/timezone windows arrive in a later update" note | ℹ️ Info | Intentional, documented deferral to Phase 55 (Slice 2) — matches ROADMAP. Not a stub; not a gap. |

No `TBD`/`FIXME`/`XXX` debt markers in any phase-changed source file. All `placeholder=` grep hits are legitimate React input attributes (masking hints like `•••••• (leave blank to keep)`).

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Day/time/timezone scoring windows (form picker + judge gate) | Phase 55 | ROADMAP Phase 55 goal + CTFT-09/10/11; the in-form note explicitly defers it |
| 2 | Wordlist answer type | Phase 56 | Segmented control intentionally omits Wordlist per LOCKED copy |

### Human Verification Required

1. **Interactive form create/edit round-trip** (SC-1/2/3) — author both a Static and a Rotating-OTP flag in a browser; confirm a preset visibly pre-fills editable Advanced knobs, secrets are masked/never-prefilled on re-edit and preserved on blank-save, and per-24h/perPlayerMax/globalMax/unlockAfter round-trip through save→reload. *Why human:* full render + DynamoDB round-trip; no jsdom in repo. Underlying logic unit-tested and JSX wired.
2. **otp-enroll reward visual** (SC-4) — on a real non-covert solve carrying an `otp-enroll` effect, scan the QR into an authenticator (code must match the on-screen CURRENT code), watch the countdown tick + roll, tap Add-to-Authenticator (deep link opens), and confirm the nextFlag line. *Why human:* QR canvas render + 1s timer are browser-only.

### Gaps Summary

No code gaps. Every artifact exists, is substantive, and is wired; all invariants hold (covert byte-identical, no new dependency, dead `Points` removed, previewPoints binds the real `computePoints`, client OTP is node-free, Phase-53 contract preserved); the full 551-test suite is green. The phase goal is achieved in the codebase to the limit of what tests/tsc/grep can prove. Status is `human_needed` (not `passed`) solely because two success criteria have a final visual/interactive proof — the QR pixel render + live countdown (SC-4) and the full interactive form round-trip (SC-1/2/3) — that this repo cannot exercise without a browser (no jsdom/testing-library). These are pixel/interaction checkpoints, not implementation gaps, per the autonomous-mode instruction to route render-only proofs to human rather than fail them.

---

_Verified: 2026-07-15_
_Verifier: Claude (gsd-verifier)_
