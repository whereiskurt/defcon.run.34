---
phase: 54-ctf-flag-types-slice-1b-frontend-admin-form-redesign-otp-enr
plan: 04
subsystem: run.human / CTF admin form (CtfForm design-A redesign)
tags: [ctf, admin-form, design-a, segmented-control, otp-enroll, write-only-secrets, live-preview, use-client]
requires:
  - "ctf-form-model.ts (54-01): presetToAdvanced / previewPoints / inferChallengeType / inferAnswerType / redactCtfSecrets + RedactedCtfRecord/LoadedCtfRecord types"
  - "CtfOtpEnroll.tsx (54-03): the player-facing otp-enroll reward card reused for the admin Reveal preview"
  - "qr-ui.ts: cls.* HeroUI token strings (cardPad, card, input, label, btn, btnPrimary, btnDanger, mono, sub)"
  - "qr-admin.ts CtfInput: answerType / otp{secret,...} / unlockAfter / perPlayerIntervalHours / perPlayerMax / globalMax (additive passthrough, no-clobber)"
  - "lucide-react ^0.561.0: ChevronDown for the Advanced disclosure affordance"
provides:
  - "CtfForm.tsx design-A: ordered sections (Name → Challenge-type presets → Answer type Static/Rotating-OTP → Scoring window & limits → Unlock & chaining → Advanced drawer → Live scoring preview)"
  - "qr-ui.ts new shared tokens: cls.segment / cls.segmentActive / cls.segmentIdle / cls.chip / cls.rewardCard (inherited by slices 55/56)"
  - "edit page routes the loaded record through redactCtfSecrets → no otp.secret / effect crosses to the client prop"
  - "Static Reward → OTP-enrollment configurator with a live Reveal preview reusing CtfOtpEnroll"
affects:
  - "55 (Slice 2 scoring windows) extends the Scoring window & limits section + reuses cls.segment for the day/tz picker"
tech-stack:
  added: []
  patterns:
    - "segmented radiogroup: role=radiogroup / role=radio buttons over PRESET_IDS + [static,otp], selected = cls.segmentActive (primary accent)"
    - "preset pre-fill without lock: applyPreset writes presetToAdvanced() partial into the string knob-state; knobs stay editable (never disabled)"
    - "write-only secret boundary end-to-end: server redactCtfSecrets → RedactedCtfRecord prop → answer/otp-secret/reward-otpauth/effect never prefilled; blank-on-save keeps stored (no-clobber)"
    - "live-preview parity: the panel calls previewPoints (the 54-01 adapter that delegates to computePoints), never a duplicate scorer"
    - "reward effect composition: a typed reward otpauth composes {kind:'otp-enroll', otpauth, nextFlag?} and takes precedence over the raw Effect JSON; blank keeps stored effect"
key-files:
  created: []
  modified:
    - apps/run.human/webapp/src/components/admin/qr-ui.ts
    - apps/run.human/webapp/src/app/(protected)/admin/qr/ctf/[challenge]/page.tsx
    - apps/run.human/webapp/src/components/admin/CtfForm.tsx
decisions:
  - "CtfForm's exported CtfRecord is aliased to RedactedCtfRecord (single source of truth) so the prop shape IS the redacted shape — the type system prevents a secret-carrying record from being passed in."
  - "The edit page casts the raw getCtf row to LoadedCtfRecord and passes redactCtfSecrets(record); the previous `record as CtfRecord` raw cast (the secret-leak site) is gone, and no `secret` token remains in the edit page."
  - "Advanced drawer is a hand-rolled disclosure (ChevronDown header + bg-content2 body inside cls.card), defaulting open on edit only when inferChallengeType==='custom' (the record did not round-trip to a clean preset)."
  - "Live scoring preview shows First solve (n=1, includes first-blood bonus) and Last solve (n=maxSolves floor) as 28px mono primary heroes, recomputed inline via previewPoints on every render."
  - "Reward otpauth is treated like the raw effect: never prefilled; when set it composes the otp-enroll payload and wins over the raw Effect JSON; blank leaves effect unset so no-clobber preserves the stored reward."
metrics:
  duration: ~20m
  completed: 2026-07-15
  tasks: 3
  files: 3
  tests_added: 0
status: complete
---

# Phase 54 Plan 04: CtfForm Design-A Redesign + Reward Configurator Summary

Restructured the admin `CtfForm.tsx` into the approved design-A layout — seven ordered section cards (Name → Challenge-type presets → Answer type Static/Rotating-OTP → Scoring window & limits → Unlock & chaining → always-editable Advanced drawer → live scoring preview) — deleted the dead standalone `Points` field, wired the new answer-type framework, per-player/global limits, and unlock/chaining through the existing `ctf_upsert` action, bound the live preview to the tested `previewPoints` seam (judge parity, no duplicated scorer), and built the Static **Reward → OTP enrollment** configurator whose Reveal preview reuses the shipped `CtfOtpEnroll` renderer so the admin sees exactly what the solver will see. The edit page now routes the loaded record through `redactCtfSecrets`, closing the secret-leak boundary: the answer, OTP secret, reward-otpauth, and effect are write-only, masked, and never prefilled on edit. All form LOGIC was pre-built and unit-tested in 54-01/54-03; this plan is layout + wiring against those pure seams. No new dependency, no covert-path change.

## What Was Built

- **`qr-ui.ts`** (modified) — added five shared tokens the redesign (and future slices 55/56) inherit: `cls.segment` (base h-9 segmented button), `cls.segmentActive` (`bg-primary text-black` selected), `cls.segmentIdle` (`bg-content1 hover:bg-content2`), `cls.chip` (small status pill for the parsed OTP digits/period/algorithm), and `cls.rewardCard` (bg-content1 card holding the reveal preview). Consistent with the surface's `h-9` / `px-3.5` control rhythm (D2).
- **`ctf/[challenge]/page.tsx`** (modified, server) — replaced the raw `record as CtfRecord` cast with `redactCtfSecrets(record as LoadedCtfRecord)`; the `otp.secret` and `effect` are stripped before the record ever becomes a `"use client"` prop (T-54-04-01). No `secret` handling remains client-bound on the edit page.
- **`CtfForm.tsx`** (modified) — full design-A restructure:
  - `CtfRecord` is now `= RedactedCtfRecord` (imported from the 54-01 model) — the prop shape IS the redacted shape.
  - **Section 1 Name** — unchanged immutable-on-edit input + lowercase resolver-URL help.
  - **Section 2 Challenge type** — a `role=radiogroup` segmented control over `PRESET_IDS` (Flat points · First-blood race · Timed drop · Easter egg · Custom); `applyPreset` records the selection AND writes `presetToAdvanced(id)` into the string knob-state; the Advanced knobs stay editable (never disabled) — T-54-04-02. LOCKED preset-helper copy verbatim.
  - **Section 3 Answer type** — a segmented control Static / Rotating OTP (Wordlist deliberately NOT rendered); inferred from the record in edit mode via `inferAnswerType`. 3a Static: masked write-only Answer input (`•••••• (leave blank to keep)`); 3b Rotating OTP: masked write-only otpauth input (`•••••• (set — leave blank to keep)`) plus a read-only `cls.chip` summary of the redacted digits/period/algorithm. LOCKED help copy verbatim.
  - **Section 4 Scoring window & limits** — numeric `Interval (hours)` → `perPlayerIntervalHours`, `Per-player max` → `perPlayerMax`, `Global max` → `globalMax`, each with its LOCKED per-field help; the always-visible LOCKED one-award/cadence note; and the LOCKED non-interactive Slice-2 placeholder note (no day/time/tz picker, per D5).
  - **Section 5 Unlock & chaining** — `Hidden until flag` text input → `unlockAfter` with the LOCKED chain-break help.
  - **Section 6 Advanced** — a hand-rolled `ChevronDown` disclosure (bg-content2 body inside `cls.card`) folding the raw knobs (Point max / Point floor / Max solves / First-blood bonus / Time-tier editor / Max attempts / Rate-limit window / Enabled / raw Effect JSON), with the LOCKED Advanced header/subtitle, the LOCKED Ceiling and anti-spam help, and a write-only Effect textarea (blank keeps the stored effect when `hasEffect`).
  - **Section 7 Live scoring preview** — a read-only panel calling `previewPoints` for the current knob values, rendering First-solve (n=1) and Last-solve (n=maxSolves) as 28px mono `primary` heroes, recomputed on every render.
  - **Static Reward → OTP enrollment** (in 3a) — a toggle (LOCKED label/help), a masked write-only `otpauth://` input + optional `Unlocks flag` name, and a `Reveal preview` that renders `CtfOtpEnroll` with the currently-typed otpauth so the admin sees the exact solver experience. On save, a typed reward composes `{kind:"otp-enroll", otpauth, nextFlag?}` as `effect` (taking precedence over the raw Effect JSON); blank leaves effect unset (no-clobber).
  - **`onSave`** — extends the `ctf_upsert` payload with `answerType`, `otp` (only when a new secret was typed), `unlockAfter`, `perPlayerIntervalHours`, `perPlayerMax`, `globalMax` via `numOrUndef`; still sends `answer` only when non-blank; the dead `points`/`setPoints` state and standalone input are **removed entirely**.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Shared segmented/reward tokens + edit-page secret redaction + redacted CtfRecord type | 0a3f03dd | qr-ui.ts, ctf/[challenge]/page.tsx, CtfForm.tsx |
| 2 | Design-A sections 1-5 — Name, presets, Answer type, limits, unlock; remove Points | abfde181 | CtfForm.tsx |
| 3 | Advanced drawer + live scoring preview + Static reward OTP-enrollment configurator + reveal preview | ef484d7d | CtfForm.tsx |

## Verification

- `npx vitest run src/components/admin/__tests__/ctf-form-model.test.ts` → **19 passed** (the seams the form binds to).
- Full webapp suite `npx vitest run` → **551 passed (55 files)** (Node 23.6.0) — no regressions.
- `npx tsc --noEmit -p tsconfig.json` → **no error referencing CtfForm, the [challenge]/page edit page, or qr-ui** (the touched files are type-clean).
- Task-1 greps: edit page `grep -n "record as CtfRecord"` → none; `grep -n "secret"` → none; `qr-ui.ts` exports all 5 new tokens.
- Task-2 greps: `grep -v '^\s*//' CtfForm.tsx | grep -c "setPoints"` → **0** (dead Points field gone); `grep -c "Wordlist"` → **0** (not rendered).
- Task-3 greps: `grep -q "previewPoints" CtfForm.tsx` → yes (preview binds the tested helper, not a duplicate scorer); `grep -q "CtfOtpEnroll" CtfForm.tsx` → yes (reveal preview reuses the 54-03 card).
- Manual (human) UI check deferred to phase verification (no jsdom/testing-library in this repo): create + edit a Static and a Rotating-OTP flag through the form; confirm a preset pre-fills editable Advanced knobs, the live preview matches expectation, secrets are masked and not prefilled on re-edit, the per-24h/perPlayerMax/globalMax limits + unlockAfter round-trip, and the Static reward Reveal preview renders the CtfOtpEnroll card.

## Threat Mitigations Applied

| Threat ID | Disposition | How |
| --------- | ----------- | --- |
| T-54-04-01 (info disclosure — edit-page prop / raw effect prefill) | mitigated | Edit page passes `redactCtfSecrets(record)`; the answer, OTP secret, reward-otpauth, and raw effect are never prefilled on edit; the raw Effect JSON follows the same blank-keeps-stored rule, so no secret round-trips. `CtfRecord = RedactedCtfRecord` makes the safe shape the only accepted prop. |
| T-54-04-02 (tampering — preset overwrites manual knobs) | mitigated | `applyPreset` pre-fills via `presetToAdvanced` but the Advanced knobs are never disabled — the admin overrides every value after picking a preset. |
| T-54-04-03 (tampering — no-clobber save regression) | mitigated | `onSave` omits `answer`/`otp`/`effect` when blank, so a partial edit preserves the stored secret/reward (mirrors the shipped `ctfAttributes` no-clobber contract). |
| T-54-04-SC (package installs) | accepted (n/a) | No installs; the reveal preview reuses the already-present `qrcode` dep via `CtfOtpEnroll`. |

## Deviations from Plan

None — the plan executed exactly as written for all three tasks. Two minor, in-scope glue decisions (no behavior change beyond the plan's intent):

1. **Effect prefill removed in Task 1 (not Task 3).** Because `CtfRecord` became the redacted shape in Task 1, the existing `initial?.effect` prefill no longer type-checks; it was switched to `useState("")` in Task 1 to compile — this is exactly the write-only behavior Task 3 requires, landed one task early. No functional divergence.
2. **Reward-effect precedence.** The plan specifies both a raw Effect JSON textarea (Advanced) and a reward otpauth (3a) that both target `effect`. `onSave` resolves the conflict by giving a typed reward otpauth precedence over the raw JSON (documented inline), which matches the plan's "compose the effect payload … send it as `effect`" instruction.

## Deferred / Out-of-Scope Issues

- **Pre-existing `tsc` errors** in `src/components/header/dropdown-user.tsx` (`@public/header/dcjack.svg` module resolution) and `src/entities/__tests__/checkin.test.ts` (ElectroDB `Entity.model` typing) — confirmed unchanged by this phase (`git diff --quiet b3944c11 HEAD` over both files) and not in this plan's changeset. Left untouched per the scope boundary; all 551 runtime tests pass regardless.

## Known Stubs

- **Slice-2 scoring window** is an intentional informational placeholder note only (no day/time/tz picker) — per UI-SPEC D5 it ships in Phase 55, which extends this section. Documented, not a blocking stub.
- **Wordlist answer type** is intentionally not rendered (a later slice); the segmented control offers only Static / Rotating OTP, matching the LOCKED copy contract.

## Self-Check: PASSED

- FOUND (modified): apps/run.human/webapp/src/components/admin/qr-ui.ts
- FOUND (modified): apps/run.human/webapp/src/app/(protected)/admin/qr/ctf/[challenge]/page.tsx
- FOUND (modified): apps/run.human/webapp/src/components/admin/CtfForm.tsx
- FOUND commits: 0a3f03dd, abfde181, ef484d7d
