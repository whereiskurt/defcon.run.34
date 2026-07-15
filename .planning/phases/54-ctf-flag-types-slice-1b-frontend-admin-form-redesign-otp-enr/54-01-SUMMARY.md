---
phase: 54-ctf-flag-types-slice-1b-frontend-admin-form-redesign-otp-enr
plan: 01
subsystem: run.human / admin CTF form
tags: [ctf, admin-form, scoring, otp, pure-model, tdd]
requires:
  - "@/lib/ctf-scoring: computePoints, ScoringConfig, TimeTier (the single client-safe scorer)"
provides:
  - "ctf-form-model.ts: PRESET_IDS, presetToAdvanced, previewPoints, inferAnswerType, inferChallengeType, redactCtfSecrets"
  - "types: ChallengeTypePreset, AdvancedKnobs, PreviewConfig, InferSource, LoadedCtfRecord, RedactedCtfRecord"
affects:
  - "54-04 (CtfForm redesign) binds to presetToAdvanced/previewPoints/inference; the edit page wires through redactCtfSecrets"
tech-stack:
  added: []
  patterns:
    - "pure client-safe model seam (no 'use client', no I/O, no node-only imports) importable from both client form and server page"
    - "preview===judge parity by delegation (previewPoints calls computePoints; no duplicate curve)"
    - "write-only-secret redaction boundary before server→client prop serialization"
key-files:
  created:
    - apps/run.human/webapp/src/components/admin/ctf-form-model.ts
    - apps/run.human/webapp/src/components/admin/__tests__/ctf-form-model.test.ts
  modified: []
decisions:
  - "Preset scoring tuples are intentionally distinct across the 4 non-custom presets so inferChallengeType round-trips a stored record unambiguously; custom = {} no-op."
  - "first-blood-race carries the largest firstBloodBonus (1000); easter-egg is a fixed single-award (maxSolves 1, pointMax==pointFloor)."
  - "redactCtfSecrets preserves only otp {digits,period,algorithm} (per plan), drops secret + skew + the entire effect; answerHash kept (drives keep-hint only, no plaintext)."
  - "Doc comments avoid the literal token 'ctf-judge' so the plan's grep guard returns nothing while keeping the no-server-import intent documented."
metrics:
  duration: ~10m
  completed: 2026-07-15
  tasks: 2
  files: 2
  tests_added: 19
status: complete
---

# Phase 54 Plan 01: CTF Flag-Types Form Model Seam Summary

Pure, client-safe form-LOGIC layer for the redesigned CtfForm: a challenge-type preset→Advanced-knobs map, a live-scoring-preview adapter that delegates to the judge's real `computePoints` (guaranteeing preview===judge parity), edit-mode answer-type/challenge-type inference, and a server-side write-only-secret redactor — all unit-tested at the pure-function level.

## What Was Built

- **`ctf-form-model.ts`** (new, no `"use client"`) exporting:
  - `PRESET_IDS` tuple + `ChallengeTypePreset` type — the single source of truth for the segmented control and the tests.
  - `presetToAdvanced(preset)` → `Partial<AdvancedKnobs>`: `flat-points` (near-flat, high cap), `first-blood-race` (steep + large bonus), `timed-drop` (tall ceiling, fast decline), `easter-egg` (fixed single-award), `custom` (`{}` no-op).
  - `previewPoints(config, n, now?)` — a thin adapter coercing may-be-string form fields (`toNum`) and delegating to `computePoints`. Structural parity: `previewPoints(cfg, n, now) === computePoints(n, cfg, now)`.
  - `inferAnswerType(record)` → `"otp"` iff stored, else `"static"` (absent default).
  - `inferChallengeType(record)` → the preset whose scoring tuple matches, else `"custom"`.
  - `redactCtfSecrets(record)` → strips `otp.secret` + entire `effect`, preserves the read-only OTP summary, surfaces `hasOtpSecret`/`hasEffect`; non-mutating.
- **`__tests__/ctf-form-model.test.ts`** (new) — 19 tests: a `config×n` parity table (first-blood, floor, over-cap⇒0, active time-tier), string/blank coercion, preset enumeration + numeric-knob assertions, inference round-trip + custom fallback, and the redaction boundary (secret/effect stripped, summary preserved, non-mutation, presence booleans, empty-secret edge).

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | presetToAdvanced + previewPoints + inference helpers | c76a774b (test/RED), d1472d95 (feat/GREEN) | ctf-form-model.ts, ctf-form-model.test.ts |
| 2 | redactCtfSecrets write-only-secret boundary | 7f9a525e (test/RED), 0f709456 (feat/GREEN) | ctf-form-model.ts, ctf-form-model.test.ts |

## Verification

- `npx vitest run src/components/admin/__tests__/ctf-form-model.test.ts` → 19 passed (Node 23.6.0).
- `grep -n "ctf-judge" src/components/admin/ctf-form-model.ts` → nothing (no server import leaked; T-54-01 guard).
- `npx vitest run src/lib/__tests__/ctf-scoring.test.ts` → 14 passed (computePoints untouched).
- Full webapp suite: **498 passed (52 files)**, no regressions.
- `npx tsc --noEmit` → clean for the new module + test.

## Threat Mitigations Applied

| Threat ID | Disposition | How |
| --------- | ----------- | --- |
| T-54-01-01 (info disclosure) | mitigated | `redactCtfSecrets` strips `otp.secret` + `effect`; tests prove no secret survives and the input is not mutated. 54-04 wires the edit page through it. |
| T-54-01-02 (preview tampering/drift) | mitigated | `previewPoints` delegates to `computePoints` — no duplicate curve to drift; parity table guards it. |
| T-54-01-SC (package installs) | accepted (n/a) | No package installs in this plan; no new dependency. |

## Deviations from Plan

Minor (no user decision required):
1. **[Rule 3 - Blocking] Doc-comment reworded to satisfy the grep guard.** The plan's acceptance criterion requires `grep "ctf-judge"` to return *nothing*, but a documentation comment naming the forbidden module tripped it. Reworded the two comments to "the judge module" so the guard is literally clean while the no-server-import intent stays documented. Commit d1472d95.
2. **[Rule 1 - Type] Test cast routed through `unknown`.** `(out as Record<string, unknown>).effect` failed `tsc` strictness (`RedactedCtfRecord` has no `effect`); changed to `as unknown as Record<string, unknown>`. Commit 0f709456.

## Known Stubs

None — every exported function is fully implemented and tested. No placeholder values, no TODO/FIXME, no empty-data-to-UI paths.

## Notes for 54-04 (consumers)

- Import `computePoints` parity via `previewPoints` — do NOT re-derive the curve in the form.
- Feed the edit page's loaded row through `redactCtfSecrets` BEFORE passing it as the client prop; use `hasOtpSecret`/`hasEffect` to drive the "already set — leave blank to keep" hints.
- `inferChallengeType`/`inferAnswerType` set the initial segmented-control selections in edit mode.
- Preset tuples live only in `presetToAdvanced`; if a preset's semantics change, `inferChallengeType` round-trips automatically (no second list to update).

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/components/admin/ctf-form-model.ts
- FOUND: apps/run.human/webapp/src/components/admin/__tests__/ctf-form-model.test.ts
- FOUND commits: c76a774b, d1472d95, 7f9a525e, 0f709456
