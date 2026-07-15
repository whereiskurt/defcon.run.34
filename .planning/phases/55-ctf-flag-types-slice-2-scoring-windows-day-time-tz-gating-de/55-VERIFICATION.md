---
phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de
verified: 2026-07-15T03:30:00Z
status: human_needed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open /admin/qr, create or edit a CTF flag, scroll to 'Scoring window & limits' → 'Restrict scoring to a time window'. Toggle it on; click the 'DEF CON run hours' chip."
    expected: "The picker renders (Days segmented buttons Sun–Sat, Opens/Closes time inputs, Timezone select PT/ET/UTC). One click on the chip highlights Thu/Fri/Sat/Sun, sets Opens=06:00, Closes=08:00, Timezone=PT. Every field remains individually editable afterward. Toggling off shows 'Scorable any time.'"
    why_human: "The picker is a 'use client' React component; its visual layout and click-to-fill interaction render only in a browser (no jsdom in this test env). The pure state helpers (formStateToScoreWindow / scoreWindowToFormState / DEFCON_RUN_HOURS) and all handler wiring are test- and grep-verified, but the on-screen render and one-click behavior are browser-only."
  - test: "Save a flag with a DEF CON run-hours window, then re-open it via the edit page."
    expected: "The picker rehydrates enabled with Thu–Sun, 06:00–08:00, PT selected — the stored IANA id America/Los_Angeles maps back to the PT label."
    why_human: "Round-trip logic (redactCtfSecrets preserves scoreWindow, scoreWindowToFormState maps IANA→label) is unit-tested, but the end-to-end edit-page rehydration render is browser-only."
---

# Phase 55: CTF Flag Types — Slice 2 Scoring Windows Verification Report

**Phase Goal:** Add time-of-day / day-of-week scoring windows to the CTF judge as a new ordered gate (step 3), additive to the `Ctf` entity and the redesigned admin form — shippable run.human PR with its own tests, covert-CSS invariant preserved. Optional `scoreWindow {days, from/to, tz:IANA}`; absent ⇒ always-open.
**Verified:** 2026-07-15T03:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `isWithinScoreWindow` is DST-correct via `Intl.DateTimeFormat` (inside/outside in the window's IANA tz) | ✓ VERIFIED | `ctf-score-window.ts:89-121` — single `Intl.DateTimeFormat(tz)` derives local weekday + HH:MM, half-open `from<=local<to`, fail-closed on bad tz. Test `ctf-score-window.test.ts:45-53` crosses DST |
| 2 | DEF CON run hours quick set = Thu–Sun {0,4,5,6} + 06:00–08:00 America/Los_Angeles | ✓ VERIFIED | `ctf-score-window.ts:54-59` const; test asserts exact shape (`ctf-score-window.test.ts:66-70`) |
| 3 | `Ctf` persists optional `scoreWindow` map additively; absent ⇒ existing rows unchanged | ✓ VERIFIED | `entities/qr.ts:170-178` map attr, NOT required; judge backward-compat test `ctf-judge-window.test.ts:137-152` |
| 4 | Form-model bridge round-trips scoreWindow ↔ form state (days+from/to+PT/ET/UTC label↔IANA); survives `redactCtfSecrets` | ✓ VERIFIED | `ctf-form-model.ts:263-280,359-384`; round-trip test `ctf-form-model.test.ts:366-378`, redaction test `:381-398` |
| 5 | A flag with `scoreWindow` scores ONLY inside window; outside returns the SAME NON_SOLVE a wrong answer yields | ✓ VERIFIED | `ctf-judge.ts:295-298`; test `ctf-judge-window.test.ts:196-208` deep-equals wrong-answer non-solve |
| 6 | Window gate fires as ordered step 3 — after unlock (1b), before attempt-cap (2) / answer-validation | ✓ VERIFIED | `ctf-judge.ts:285-298` placed after unlock block, before `overAttemptLimit`; test `:236-248` proves closed window short-circuits before cap is reached |
| 7 | A flag with NO `scoreWindow` is completely unaffected (backward compat) | ✓ VERIFIED | `ctf-judge.ts:295` `if (ctf.scoreWindow && ...)`; test `:137-152` |
| 8 | Closed window on covert channel is indistinguishable (NON_SOLVE, no reward); gate never logs guess/secret | ✓ VERIFIED | `ctf-judge.ts:296` logs coarse `no-solve` only; test `:256-266` covert channel identical NON_SOLVE; `:175-193` asserts guess never logged |
| 9 | Admin can set day/time/tz window (weekday multi-select + Opens/Closes + PT/ET/UTC) and toggle hides/clears it | ✓ VERIFIED (logic) / see Human Verification (render) | `CtfForm.tsx:627-731` full picker wired; toggle `windowEnabled` conditional render + off ⇒ `formStateToScoreWindow` returns undefined |
| 10 | Quick set fills Thu–Sun 06:00–08:00 PT in one click, fields stay editable | ✓ VERIFIED (logic) / see Human Verification (interaction) | `applyDefconRunHours` `CtfForm.tsx:251-258` sets each controlled input; button `:647-653` |
| 11 | Stored tz is IANA id; window round-trips save→edit | ✓ VERIFIED | qr-admin passthrough `qr-admin.ts:380` verbatim; `scoreWindowToFormState` IANA→label + init `CtfForm.tsx:183`; round-trip test `ctf-form-model.test.ts:366-378` |
| 12 | Write path passes scoreWindow only when provided (no-clobber on partial edits) | ✓ VERIFIED | `qr-admin.ts:380` spread only `!== undefined`; tests `qr-admin.test.ts:205-220` emit-verbatim + omit-when-absent + scoreWindow-only-edit-no-flip-guard |

**Score:** 12/12 truths verified (0 present, behavior-unverified). Two truths (#9, #10) have their pure logic + wiring fully verified; only their in-browser visual render/click behavior is routed to human verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/ctf-score-window.ts` | Pure DST predicate + constants | ✓ VERIFIED | 122 lines, node-free, `isWithinScoreWindow` + `TZ_OPTIONS` + `DEFCON_RUN_HOURS`; imported by judge + form-model |
| `src/lib/ctf-judge.ts` | Step-3 window gate | ✓ VERIFIED | Gate at `:295-298`; `narrowCtf` carries `scoreWindow` onto JudgeCtf `:518-525` |
| `src/entities/qr.ts` | Additive `scoreWindow` map | ✓ VERIFIED | `:170-178`, optional |
| `src/components/admin/ctf-form-model.ts` | Bridge helpers + redaction passthrough | ✓ VERIFIED | `:263-280,313,340,380` |
| `src/components/admin/CtfForm.tsx` | Day/time/tz picker + quick set | ✓ VERIFIED (wiring) | `:183-188,251-258,624-731`; render browser-only |
| `src/lib/qr-admin.ts` | scoreWindow write passthrough | ✓ VERIFIED | `:165,380` |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| ctf-judge.ts | ctf-score-window.ts | `import { isWithinScoreWindow, type ScoreWindow }` | ✓ WIRED (`ctf-judge.ts:13`, used `:295`) |
| ctf-form-model.ts | ctf-score-window.ts | `import { TZ_OPTIONS, type ScoreWindow }` | ✓ WIRED (`:25`, used in both bridge helpers) |
| CtfForm.tsx | ctf-form-model.ts + ctf-score-window.ts | `formStateToScoreWindow/scoreWindowToFormState` + `TZ_OPTIONS/DEFCON_RUN_HOURS` | ✓ WIRED (`:15-16,22`, used `:183,252,316`) |
| CtfForm onSave | qr-admin.ctfAttributes | `ctf.scoreWindow` emitted only when set → `input.scoreWindow` passthrough | ✓ WIRED (`CtfForm.tsx:344` → `qr-admin.ts:380`) |
| narrowCtf | JudgeCtf.scoreWindow | loaded row's scoreWindow coerced onto the scoring shape | ✓ WIRED (`ctf-judge.ts:518-525`) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full webapp suite | `npx vitest run` (Node 23.6.0) | 57 files / 591 tests passed | ✓ PASS |
| Type safety of phase-55 files | `npx tsc --noEmit` filtered to phase-55 paths | 0 errors in any phase-55 file | ✓ PASS |
| DST boundary (judge + predicate) | vitest `ctf-score-window.test.ts` + `ctf-judge-window.test.ts` | summer 13:30Z PDT inside, winter 13:30Z PST outside | ✓ PASS |

Note: repo-wide `tsc` reports 5 pre-existing errors in unrelated files (`header/dropdown-user.tsx` svg-module resolution, `entities/__tests__/checkin.test.ts`). Neither is touched by Phase 55; not a phase gap.

### Covert Invariant (T-53-04-01)

| Check | Result |
|-------|--------|
| `git diff --name-only 9373fe66..HEAD` touches any covert/egg source | NONE — only the 6 planned source files + their tests + planning docs |
| `git diff 9373fe66..HEAD -- **covert** **egg**` | empty (byte-identical) |
| Covert-invariant regression tests (`ctf-covert-css`, `ctf-reward-covert-invariant`, `covert-egg`) | green |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| CTFT-09 (additive optional scoreWindow, backward-compat) | 55-01 | ✓ SATISFIED | Truths 1–4; entity `:170-178` |
| CTFT-10 (judge step-3 gate, DST, indistinguishable, no log) | 55-02 | ✓ SATISFIED | Truths 5–8 |
| CTFT-11 (form picker + quick set + round-trip + IANA) | 55-03 | ✓ SATISFIED (logic) / human render | Truths 9–12 |

### Anti-Patterns Found

None. No TODO/FIXME/XXX/HACK debt markers in phase-55 files. All `placeholder=` matches are legitimate HTML `<input>` placeholder attributes, not stub markers.

### Human Verification Required

See frontmatter `human_verification`. Two items, both browser-only per the picker being a `use client` component with no jsdom in the test env:
1. Picker renders + "DEF CON run hours" one-click fill (fields stay editable, toggle-off shows "Scorable any time.").
2. Save→edit rehydration renders Thu–Sun/06:00/08:00/PT from the stored IANA id.

The judge gate, DST correctness, IANA storage, no-clobber write path, round-trip logic, and covert byte-identity are all logic-testable and were verified for real (591 tests green).

### Gaps Summary

No gaps. Every logic-provable invariant of the phase goal — step-3 gate placement, closed-window NON_SOLVE indistinguishability, DST-correct evaluation crossing a real PDT/PST boundary, additive/backward-compatible entity, IANA-id storage, save→edit round-trip helpers, no-clobber write passthrough, and byte-identical covert path — is verified against the codebase and its 591-test suite. Status is `human_needed` solely because the admin picker's visual layout and click interaction are browser-only (no jsdom) and cannot be exercised by the automated suite.

---

_Verified: 2026-07-15T03:30:00Z_
_Verifier: Claude (gsd-verifier)_
