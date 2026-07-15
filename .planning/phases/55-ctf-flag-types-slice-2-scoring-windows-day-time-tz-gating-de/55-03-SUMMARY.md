---
phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de
plan: 03
subsystem: ctf
tags: [ctf, scoring-window, admin-form, timezone, day-time-picker, defcon-run-hours, no-clobber]

# Dependency graph
requires:
  - phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de
    plan: 01
    provides: "ctf-form-model bridge (formStateToScoreWindow / scoreWindowToFormState), TZ_OPTIONS, DEFCON_RUN_HOURS, ScoreWindow type, scoreWindow through redactCtfSecrets"
  - phase: 54-ctf-flag-types-slice-1b-frontend
    provides: "redesigned CtfForm.tsx §4 Scoring window & limits section + qr-ui cls.segment/segmentActive/segmentIdle/chip/select tokens"
  - phase: 53-ctf-flag-types-slice-1a-backend
    provides: "qr-admin ctfAttributes no-clobber passthrough pattern + CtfInput additive-field convention; mergeFlagTypeNextState flip guard"
provides:
  - "CtfForm day/time/tz scoring-window picker (CTFT-11): enable toggle + Sun–Sat weekday chips + Opens/Closes time inputs + PT/ET/UTC select (stores IANA id) + DEF CON run-hours quick set"
  - "CtfInput.scoreWindow + ctfAttributes verbatim no-clobber passthrough (not a flag-type/flip-guard field)"
affects: [56 wordlist slice reuses the same §4 authoring surface + no-clobber passthrough discipline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Picker rehydrates from initial.scoreWindow ONLY through the pure 55-01 bridge — the label↔IANA mapping lives in one place, so save and edit-mode rehydrate can never drift"
    - "Presets pre-fill, never lock: the DEF CON run-hours quick set fills all fields then leaves each individually editable (mirrors applyPreset)"
    - "onSave spreads `...(scoreWindow ? { scoreWindow } : {})` so OFF ⇒ no key ⇒ no-clobber; qr-admin mirrors it verbatim"

key-files:
  created: []
  modified:
    - apps/run.human/webapp/src/components/admin/CtfForm.tsx
    - apps/run.human/webapp/src/lib/qr-admin.ts
    - apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts

key-decisions:
  - "Reused the existing `<select>` (cls.select) + native `type=\"time\"` inputs and the cls.segment chip pattern rather than introducing HeroUI Select/TimeInput — matches sibling controls, adds zero dependency, keeps the surface tsc-clean without jsdom coverage"
  - "Weekday chips use role=\"switch\"/aria-checked (independent multi-select toggles) rather than radiogroup — distinct from the single-select challenge-type presets"
  - "scoreWindow is emitted verbatim through ctfAttributes and is deliberately NOT wired into mergeFlagTypeNextState — a window-only edit of a solved flag must not trip the CTFT-06 static↔repeatable flip guard (asserted by test)"
  - "Toggling OFF sends no scoreWindow key (no-clobber, consistent with §4's other fields); clearing a stored window is delete+recreate, matching the section's existing discipline"

requirements-completed: [CTFT-11]

coverage:
  - id: SC3
    description: "One-click DEF CON run-hours quick set fills Thu–Sun 06:00–08:00 PT and fields stay editable; the value round-trips and stores an IANA id"
    requirement: CTFT-11
    verification:
      - kind: unit
        ref: "src/components/admin/__tests__/ctf-form-model.test.ts (55-01 round-trip proof: scoreWindowToFormState∘formStateToScoreWindow) + src/lib/__tests__/qr-admin.test.ts#emits scoreWindow verbatim when provided"
        status: pass
      - kind: manual
        ref: "open /admin/qr/ctf/new → enable window → click DEF CON run hours → Thu·Fri·Sat·Sun, Opens 06:00, Closes 08:00, tz PT, all fields editable"
        status: deferred
    human_judgment: true
  - id: T-55-03-01
    description: "ctfAttributes scoreWindow passthrough is no-clobber (emitted only when provided) and does not touch the flip guard — a window-only edit of a solved flag can't corrupt scoring-history semantics"
    requirement: CTFT-11
    verification:
      - kind: unit
        ref: "src/lib/__tests__/qr-admin.test.ts#omits scoreWindow when absent (no-clobber preserves the stored window) + #a scoreWindow-only edit emits no flag-type keys"
        status: pass
    human_judgment: false
  - id: T-55-03-03
    description: "No player-facing window/countdown UI added — the window is enforced silently in the judge; form copy states the covert-safe behavior to the admin only"
    requirement: CTFT-11
    verification:
      - kind: manual
        ref: "CtfForm §4 copy: 'Outside it, a correct answer silently doesn't score — players can't tell the window is closed'; no player-facing surface touched"
        status: pass
    human_judgment: true

# Metrics
duration: 4min
completed: 2026-07-15
status: complete
---

# Phase 55 Plan 03: Admin Day/Time/TZ Scoring-Window Picker Summary

**Replaced the Phase-54 Slice-2 placeholder note in `CtfForm.tsx`'s Scoring window & limits section with the real day/time/tz picker (CTFT-11) — enable toggle + Sun–Sat chips + Opens/Closes + PT/ET/UTC select (stores IANA id) + the "DEF CON run hours" quick set — and wired `scoreWindow` through the `qr-admin` no-clobber write passthrough. This is the LAST plan of Phase 55 (3/3, COMPLETE).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-15T07:18:33Z
- **Completed:** 2026-07-15
- **Tasks:** 2
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments
- **CtfForm §4 picker (Task 1):** the placeholder note ("Day / time / timezone windows arrive in a later update…") is gone. In its place:
  - an enable toggle ("Restrict scoring to a time window") that reveals the picker; OFF shows "Scorable any time." and persists no `scoreWindow`;
  - 7 weekday toggle chips Sun–Sat (0=Sun..6=Sat) reusing `cls.segment`/`segmentActive`/`segmentIdle`, `role="switch"` + `aria-checked` + `aria-label`;
  - `Opens` / `Closes` `type="time"` (24h HH:mm) inputs with `htmlFor`-linked labels;
  - a PT/ET/UTC `<select>` (cls.select) listing exactly `TZ_OPTIONS` — the stored value is the IANA id, resolved by the 55-01 bridge on save;
  - the accent **"DEF CON run hours"** quick-set button (cls.btnPrimary) with sub-hint "Thu–Sun, 6–8 AM PT" that fills state from `scoreWindowToFormState(DEFCON_RUN_HOURS)` and leaves every field editable;
  - the exact UI-SPEC copy (section helper covert-safe statement + tz DST note);
  - a non-blocking "window-gated" chip near the live preview (the window affects *whether* it scores, not the point value).
- **State rehydration:** `const swInit = scoreWindowToFormState(initial?.scoreWindow)` seeds `windowEnabled/windowDays/windowFrom/windowTo/windowTzLabel`, so an existing flag round-trips through save→edit and a new flag starts disabled.
- **onSave:** computes `formStateToScoreWindow(...)` and spreads `...(scoreWindow ? { scoreWindow } : {})` into the `ctf` payload (OFF ⇒ no key ⇒ no-clobber).
- **qr-admin passthrough (Task 2):** added `scoreWindow?: { days?; from?; to?; tz? }` to `CtfInput` and `...(input.scoreWindow !== undefined ? { scoreWindow: input.scoreWindow } : {})` to `ctfAttributes`, next to the perPlayerMax/globalMax passthrough. `mergeFlagTypeNextState`/`assertAnswerTypeTransition` left untouched — `scoreWindow` is not part of the repeatable-ness decision.

## Task Commits

Each task was committed atomically:

1. **Task 1: Day/time/tz picker in CtfForm §4 (CTFT-11)** — `8aaf7615` (feat)
2. **Task 2: scoreWindow write-path passthrough + no-clobber test** — `bcb6e24f` (feat)

## Files Created/Modified
- `apps/run.human/webapp/src/components/admin/CtfForm.tsx` — modified: imports (bridge helpers + TZ_OPTIONS/DEFCON_RUN_HOURS), WEEKDAY_LABELS constant, 5 picker state hooks seeded from `swInit`, `toggleWindowDay` + `applyDefconRunHours` helpers, the placeholder note replaced with the picker, `scoreWindow` added to the onSave payload, "window-gated" preview annotation.
- `apps/run.human/webapp/src/lib/qr-admin.ts` — modified: `CtfInput.scoreWindow` field + `ctfAttributes` verbatim no-clobber passthrough.
- `apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts` — modified: 3 new cases in the `ctfAttributes` describe block (verbatim-when-provided, absent-when-omitted, scoreWindow-only emits no flag-type keys).

## Decisions Made
- **Native controls over HeroUI Select/TimeInput:** reused the section's existing `cls.select` `<select>` + `type="time"` inputs + `cls.segment` chip pattern — matches sibling controls, adds no dependency, and stays verifiable via tsc + the pure bridge (no jsdom).
- **role="switch" for weekday chips:** independent multi-select toggles, distinct from the single-select `radiogroup` challenge-type presets.
- **scoreWindow is not a flag-type field:** deliberately excluded from `mergeFlagTypeNextState` so a window-only edit of a solved flag never trips the CTFT-06 flip guard (asserted).
- **OFF ⇒ no-clobber:** toggling off sends nothing (leaves the stored window); clearing is delete+recreate, mirroring §4's other fields.

## Deviations from Plan

None - plan executed exactly as written. (The optional `type ScoreWindowFormState` import from the plan was not added since the state is seeded from the `scoreWindowToFormState` return inline — importing an unused type would introduce a noUnusedLocals error.)

## Issues Encountered
None. CtfForm tsc-clean on first check; qr-admin tests green (45); full webapp suite 591 green (57 files). Only the 2 pre-existing out-of-scope tsc errors (dropdown-user.tsx, checkin.test.ts) remain, untouched.

## User Setup Required
None - no external service configuration required.

## Verification Evidence
- `npx tsc --noEmit` → CtfForm.tsx tsc-clean; no new errors beyond the 2 pre-existing out-of-scope ones.
- `npx vitest run src/lib/__tests__/qr-admin.test.ts` → 45 passed.
- `npx vitest run` (full webapp suite) → 591 passed, 57 files.

## Next Phase Readiness
- **Phase 55 COMPLETE (3/3).** The authoring half (this plan) writes the `scoreWindow` the 55-02 judge gate reads; the round-trip is proven at the pure 55-01 seam + the qr-admin passthrough test here.
- **Phase 56 (Slice 3 Wordlist):** reuses the same §4/Answer-type authoring surface and the no-clobber `ctfAttributes` passthrough discipline. Run `/gsd-plan-phase 56` to break it down.
- Manual visual check deferred (non-blocking): open /admin/qr/ctf/new, enable the window, click "DEF CON run hours" → chips show Thu·Fri·Sat·Sun, Opens 06:00, Closes 08:00, tz PT; every field still editable.

## Self-Check: PASSED

---
*Phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de*
*Completed: 2026-07-15*
