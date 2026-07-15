---
phase: 57-ctf-form-qr-polish-dc33-seed-data
plan: 01
subsystem: ui
tags: [heroui, tailwind, ctf, admin, restyle, theme-aware, react]

# Dependency graph
requires:
  - phase: 54-ctf-flag-types (Slice 1b CtfForm)
    provides: CtfForm.tsx structure, qr-ui.ts cls token layer, presetToAdvanced/previewPoints model
provides:
  - Restyled admin CtfForm (Surface A) with soft-glow selected segments, two-line challenge-type descriptors, stat-tile live-scoring preview, amber window-note callout, mono uppercase labels
  - segmentActive soft-glow + segmentStacked two-line tokens in the shared qr-ui cls layer
affects: [ctf-form, admin-qr, ctf-otp-enroll, phase-58-plus-ctf-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Theme-aware selection glow via bg-primary/10 + ring-1 ring-inset ring-primary/40 (no raw hex on Surface A)"
    - "Amber semantic callout uses `secondary` token (defined amber in BOTH light+dark maps) — not `warning` (undefined in the light map)"
    - "Stat-tile row: bordered bg-content1 tiles inside a bg-content2 tinted container, mono tabular-nums value over UPPERCASE mono key"

key-files:
  created: []
  modified:
    - apps/run.human/webapp/src/components/admin/qr-ui.ts
    - apps/run.human/webapp/src/components/admin/CtfForm.tsx

key-decisions:
  - "Used `secondary` (amber #f59e0b dark / #d97706 light — defined in both HeroUI maps) for the window note; `warning` is absent from the light theme map so it would not be reliably amber in light mode."
  - "Added a `segmentStacked` token rather than mutating base `cls.segment` (keeps answer-type/weekday rows single-line at h-9 while challenge-type goes two-line)."
  - "Added `font-mono` to `cls.label` to satisfy the UI-SPEC field-label typography contract (mono uppercase); the plan's 'keep' wording assumed it was already mono."
  - "Answer-type buttons kept single-line per plan; descriptor rendered as a dynamic helper caption under the segment row."

patterns-established:
  - "Surface A stays fully inside HeroUI semantic tokens; zero raw mockup darks."
  - "Selection emphasis = accent border + inset glow, not a solid primary fill."

requirements-completed: [CTFP-01]

coverage:
  - id: D1
    description: "Selected challenge-type segment shows accent border + soft inner glow; idle segments stay neutral (segmentActive/segmentIdle tokens)."
    requirement: CTFP-01
    verification:
      - kind: unit
        ref: "src/components/admin/__tests__/ctf-form-model.test.ts (preset/answer logic unchanged — 40 tests)"
        status: pass
      - kind: manual_procedural
        ref: "Human-verify Task 3: light+dark theme render of segment glow"
        status: unknown
    human_judgment: true
    rationale: "Selection glow legibility/aesthetics in both light and dark app themes require a human eyeball; automation only proves the underlying preset logic is untouched."
  - id: D2
    description: "Challenge-type segments render name over a one-line descriptor matching UI-SPEC copy verbatim; answer-type gains a single-line helper descriptor."
    requirement: CTFP-01
    verification:
      - kind: unit
        ref: "src/components/admin/__tests__/ctf-form-model.test.ts (PRESET_IDS/AnswerType values unchanged)"
        status: pass
    human_judgment: true
    rationale: "Two-line layout wrapping/readability is a visual judgment; unit tests only cover the underlying model, not the rendered copy layout."
  - id: D3
    description: "Live scoring preview renders as bordered stat tiles (20px mono tabular-nums value over UPPERCASE mono key) inside a tinted container; previewConfig/previewPoints calls unchanged."
    requirement: CTFP-01
    verification:
      - kind: unit
        ref: "src/components/admin/__tests__/ctf-form-model.test.ts#previewPoints (call signature unchanged)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit on CtfForm.tsx/qr-ui.ts (clean — 0 errors in touched files)"
        status: pass
    human_judgment: true
    rationale: "Stat-tile visual density/legibility vs the mockup is a human sign-off."
  - id: D4
    description: "Timed-drop / scoring-window callout renders in amber (secondary token), theme-aware in both light and dark."
    requirement: CTFP-01
    verification:
      - kind: manual_procedural
        ref: "Human-verify Task 3: amber note legible in light+dark; no raw darks leaked"
        status: unknown
    human_judgment: true
    rationale: "AA-legibility of the amber note on card surfaces in both themes needs a human check."

# Metrics
duration: 3min
completed: 2026-07-15
status: complete
---

# Phase 57 Plan 01: CTF Admin Form (Surface A) Restyle Summary

**Admin CtfForm restyled to the approved mockup treatment — soft-glow selected segments, two-line challenge-type descriptors, a stat-tile live-scoring preview, and an amber window-note callout — entirely within HeroUI semantic tokens (theme-aware, zero raw mockup darks), with all preset/preview logic frozen and 40 form-model tests still green.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-15T18:17:37Z
- **Completed:** 2026-07-15T18:20:33Z
- **Tasks:** 2 code tasks complete; 1 human-verify checkpoint pending (Task 3)
- **Files modified:** 2

## Accomplishments
- `cls.segmentActive` is now a theme-aware soft inner glow (`bg-primary/10` + `border-primary` + `ring-1 ring-inset ring-primary/40`) instead of a solid primary fill — the mockup's selection treatment translated to HeroUI tokens.
- Challenge-type picker renders each preset as a two-line segment (name over a one-line descriptor) via a new `segmentStacked` token; descriptors match the UI-SPEC copy verbatim.
- Live scoring preview converted from two loose 28px numbers into a bordered stat-tile row (20px mono `tabular-nums` value over a 10.5px UPPERCASE mono key) inside a `bg-content2` tinted container — `previewConfig`/`previewPoints(...)` calls unchanged.
- Window-gated note restyled as a soft amber callout using the `secondary` token (amber in both light and dark maps).
- `cls.label` now mono per the UI-SPEC typography contract; Section 1 `<code>` help text styled as a subtle mono chip on `bg-content2`; answer-type row gained a single-line helper descriptor.

## Task Commits

1. **Task 1: Restyle cls tokens + challenge-type / answer-type segments** — `673d8a2a` (feat)
2. **Task 2: Stat-tile live-scoring preview + amber window note + card rhythm** — `83f9fccd` (feat)
3. **Task 3: Human-verify Surface A in light + dark** — CHECKPOINT PENDING (see below)

## Files Created/Modified
- `apps/run.human/webapp/src/components/admin/qr-ui.ts` — `segmentActive` soft glow, new `segmentStacked` two-line token, `cls.label` made mono.
- `apps/run.human/webapp/src/components/admin/CtfForm.tsx` — two-line challenge-type segments + `PRESET_DESC`/`ANSWER_DESC` copy maps, stat-tile preview, amber window callout, mono code chip, answer-type helper caption.

## Decisions Made
- **Amber = `secondary` token, not `warning`.** `tailwind.config.js` defines `secondary` as amber in BOTH the dark (`#f59e0b`) and light (`#d97706`) color maps, but `warning` is absent from the light map — so `text-warning` would not be reliably amber in light theme. Using `secondary` guarantees the theme-aware amber the UI-SPEC (which lists "`secondary`/`warning`") requires.
- **New `segmentStacked` token instead of mutating `cls.segment`.** Keeps answer-type + weekday rows at the existing single-line `h-9` rhythm while the challenge-type row goes two-line — no cross-surface regression (CtfOtpEnroll and weekday picker also consume `cls.segment`).
- **`cls.label` gained `font-mono`.** The UI-SPEC Typography table specifies the field label as mono; the plan's "keep mono" wording assumed it already was. Adding `font-mono` implements the locked contract (purely visual, no logic/test impact).
- **Answer-type kept single-line** per the plan ("keeps single-line labels"), with the descriptor surfaced as a dynamic helper caption under the row.

## Deviations from Plan

None affecting behavior — all changes are class-string / copy restyle within scope. One in-scope clarification: `cls.label` was made mono to satisfy the UI-SPEC typography contract (the plan described it as already mono). No preset, `presetToAdvanced`, `previewPoints`, `ctf_upsert`/`ctf_delete`, validation, judge, scoring, entity, API, or covert code was touched.

## Issues Encountered
- `tsc --noEmit` is not globally clean in the webapp, but the 5 reported errors are all pre-existing and in unrelated files (`dropdown-user.tsx` missing SVG module decl; `checkin.test.ts` ElectroDB typings). The two files this plan touched produce **zero** tsc errors. Logged to `deferred-items.md`; not fixed (scope boundary).

## Human-Verify Checkpoint (Task 3) — PENDING

This is a blocking `checkpoint:human-verify` that Claude cannot self-complete (auth-gated admin route + subjective light/dark visual judgment). All code tasks are complete and automated checks pass; recorded here as pending per the orchestrator's instruction (do not block indefinitely).

**How to verify:**
1. From `apps/run.human/webapp`: `PORT=3001 npm run dev`.
2. Open `/admin/qr` → create/edit a challenge.
3. LIGHT theme: active challenge-type segment has an accent glow; descriptors read on line two; live preview shows bordered stat tiles; window note is amber; no harsh near-black mockup panels (colors track the rest of `/admin`).
4. Toggle DARK theme: same surfaces render correctly, AA-legible.

**Resume signal:** "approved", or describe any theme/contrast issues.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Surface A restyle code-complete and unit/tsc-clean (for the touched files). Ready for the human light/dark verification pass.
- Surface B (player OTP reward reveal, `CtfOtpEnroll.tsx` / `ClaimClient.tsx`) and the DC33 seed script are separate plans (57-02 / 57-03) and untouched here.

## Known Stubs
None — this plan added no data-bound placeholders; it is a pure visual restyle over already-wired form logic.

## Self-Check: PASSED

- FOUND: `57-01-SUMMARY.md`
- FOUND: `apps/run.human/webapp/src/components/admin/qr-ui.ts`
- FOUND: `apps/run.human/webapp/src/components/admin/CtfForm.tsx`
- FOUND commit: `673d8a2a` (Task 1)
- FOUND commit: `83f9fccd` (Task 2)

---
*Phase: 57-ctf-form-qr-polish-dc33-seed-data*
*Completed: 2026-07-15*
