---
phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de
plan: 01
subsystem: ctf
tags: [ctf, scoring-window, intl-datetimeformat, dst, timezone, electrodb, form-model]

# Dependency graph
requires:
  - phase: 53-ctf-flag-types-slice-1a-backend
    provides: additive-optional Ctf attribute pattern (unlockAfter/perPlayerMax/globalMax), pure structurally-typed lib convention (ctf-flag-types.ts)
  - phase: 54-ctf-flag-types-slice-1b-frontend
    provides: ctf-form-model.ts pure seam (redactCtfSecrets write-only boundary, LoadedCtfRecord/RedactedCtfRecord)
provides:
  - "ctf-score-window.ts: pure DST-correct isWithinScoreWindow(window, nowMs) via Intl.DateTimeFormat, fail-closed on invalid tz"
  - "DEFCON_RUN_HOURS constant (Thu-Sun 06:00-08:00 America/Los_Angeles) + TZ_OPTIONS (PT/ET/UTC ↔ IANA single source of truth)"
  - "ScoreWindow type {days, from, to, tz} — wall-clock HH:MM, IANA tz"
  - "additive optional Ctf.scoreWindow map attribute (CTFT-09); absent ⇒ always-open"
  - "ctf-form-model bridge: formStateToScoreWindow / scoreWindowToFormState round-trip + scoreWindow through redactCtfSecrets"
affects: [55-02 judge scoring-window gate (CTFT-10), 55-03 admin day/time/tz picker (CTFT-11)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Node-free, structurally-typed pure lib (no entity/electro import) consumed by BOTH server judge and client form"
    - "Half-open [from,to) wall-clock window evaluated in IANA tz via a single Intl.DateTimeFormat.formatToParts (DST automatic)"
    - "PT/ET/UTC label ↔ IANA id mapped through ONE shared TZ_OPTIONS list so save and rehydrate cannot drift"

key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-score-window.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-score-window.test.ts
  modified:
    - apps/run.human/webapp/src/entities/qr.ts
    - apps/run.human/webapp/src/components/admin/ctf-form-model.ts
    - apps/run.human/webapp/src/components/admin/__tests__/ctf-form-model.test.ts

key-decisions:
  - "Resolved the spec's from/to (design field table) vs ROADMAP's startTime/endTime naming to from/to per the authoritative design spec"
  - "Store IANA tz id (not a fixed offset) so PDT/PST tracks DST automatically via Intl"
  - "Fail-closed: any Intl error (invalid tz) returns false (deny) — never leaks the reason"
  - "Unknown/unmapped IANA id rehydrates to the UTC label (safe global fallback) so the picker always renders a valid selection"
  - "Off toggle ⇒ formStateToScoreWindow returns undefined (nothing persisted, always-open), matching UI-SPEC 'toggling off clears the payload'"

patterns-established:
  - "Wall-clock ScoreWindow from/to are SEMANTICALLY DISTINCT from Ctf.timeTiers' UTC-ISO from/to — loudly commented in both entity + type"
  - "scoreWindow is a non-secret that rides through the redaction boundary so the edit page can rehydrate the picker"

requirements-completed: [CTFT-09]

coverage:
  - id: D1
    description: "isWithinScoreWindow is DST-correct: same UTC instant resolves summer-inside / winter-outside a Thu-Sun 06:00-08:00 America/Los_Angeles window via Intl"
    requirement: CTFT-09
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-score-window.test.ts#resolves the SAME UTC hour to DIFFERENT LA wall-clock across DST"
        status: pass
    human_judgment: false
  - id: D2
    description: "isWithinScoreWindow inside/outside by day + half-open time bound; fail-closed on invalid tz"
    requirement: CTFT-09
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-score-window.test.ts#isWithinScoreWindow — inside/outside by day and time"
        status: pass
      - kind: unit
        ref: "src/lib/__tests__/ctf-score-window.test.ts#returns false (deny) when the tz is undecodable"
        status: pass
    human_judgment: false
  - id: D3
    description: "DEFCON_RUN_HOURS quick set = Thu-Sun 06:00-08:00 America/Los_Angeles; TZ_OPTIONS = PT/ET/UTC ↔ IANA"
    requirement: CTFT-09
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-score-window.test.ts#DEFCON_RUN_HOURS quick-set constant"
        status: pass
    human_judgment: false
  - id: D4
    description: "additive optional Ctf.scoreWindow map attribute; absent ⇒ unchanged behavior, tsc-clean"
    requirement: CTFT-09
    verification:
      - kind: unit
        ref: "cd apps/run.human/webapp && npx tsc --noEmit (no new error in qr.ts)"
        status: pass
    human_judgment: false
  - id: D5
    description: "form-model bridge round-trips scoreWindow ↔ form state (label↔IANA); scoreWindow survives redactCtfSecrets"
    requirement: CTFT-09
    verification:
      - kind: unit
        ref: "src/components/admin/__tests__/ctf-form-model.test.ts#round-trip — scoreWindowToFormState(formStateToScoreWindow(state))"
        status: pass
      - kind: unit
        ref: "src/components/admin/__tests__/ctf-form-model.test.ts#carries scoreWindow through UNCHANGED onto the redacted record"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-15
status: complete
---

# Phase 55 Plan 01: Scoring-Window Foundation Summary

**Pure DST-correct `isWithinScoreWindow` (Intl-based, fail-closed) + additive optional `Ctf.scoreWindow` + `ctf-form-model` label↔IANA round-trip bridge — the shared Wave-1 seam both Wave-2 plans consume.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-15T07:04:02Z
- **Completed:** 2026-07-15T07:08:12Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `ctf-score-window.ts`: pure, node-free `isWithinScoreWindow(window, nowMs)` evaluating the instant in the window's IANA tz via a single `Intl.DateTimeFormat.formatToParts` — DST is automatic. Half-open `[from, to)`, weekday-set gated, and fail-closed (invalid tz → `false`, never leaks). Exports `ScoreWindow`, `TZ_OPTIONS` (PT/ET/UTC ↔ IANA), and `DEFCON_RUN_HOURS` (Thu-Sun 06:00-08:00 America/Los_Angeles).
- DST-boundary test proves the mechanism: `2026-08-06T13:30Z` (06:30 PDT) is INSIDE while `2026-01-08T13:30Z` (05:30 PST) — identical UTC hour — is OUTSIDE.
- Additive optional `Ctf.scoreWindow` map `{days:list<number>, from, to, tz}` on the entity — no default, not required; absent ⇒ always-scorable, no migration (CTFT-09).
- `ctf-form-model` bridge: `formStateToScoreWindow` (off ⇒ `undefined`; label → IANA) and `scoreWindowToFormState` (absent ⇒ disabled default; IANA → label with UTC fallback), plus `scoreWindow` threaded through `LoadedCtfRecord`/`RedactedCtfRecord` and carried unchanged by `redactCtfSecrets` (non-secret).

## Task Commits

Each task was committed atomically (TDD tasks are test → feat):

1. **Task 1: Pure DST-correct window predicate + DEFCON_RUN_HOURS** — `5bb048ad` (test, RED) → `7605151f` (feat, GREEN)
2. **Task 2: Additive optional Ctf.scoreWindow map attribute** — `f95d1f01` (feat)
3. **Task 3: Form-model bridge + scoreWindow redaction round-trip** — `b89a5e8a` (test, RED) → `0d3bf59f` (feat, GREEN)

## Files Created/Modified
- `apps/run.human/webapp/src/lib/ctf-score-window.ts` — created: ScoreWindow type, TZ_OPTIONS, DEFCON_RUN_HOURS, isWithinScoreWindow (Intl-based, fail-closed).
- `apps/run.human/webapp/src/lib/__tests__/ctf-score-window.test.ts` — created: inside/outside by day+time, DST boundary, invalid-tz deny, DEFCON_RUN_HOURS/TZ_OPTIONS.
- `apps/run.human/webapp/src/entities/qr.ts` — modified: added optional `Ctf.scoreWindow` map attribute (no default).
- `apps/run.human/webapp/src/components/admin/ctf-form-model.ts` — modified: ScoreWindowFormState + bridge helpers; scoreWindow threaded through records and redactCtfSecrets.
- `apps/run.human/webapp/src/components/admin/__tests__/ctf-form-model.test.ts` — modified: bridge round-trip + redaction-preserves-scoreWindow cases.

## Decisions Made
- **from/to naming:** resolved the design-spec `from/to` vs ROADMAP `startTime/endTime` discrepancy to `from/to` per the authoritative design spec; loudly commented that these wall-clock HH:MM bounds are distinct from `timeTiers`' UTC-ISO from/to.
- **IANA storage over offset:** store the IANA id so DST is handled by Intl at evaluation time, never a frozen offset.
- **Fail-closed:** the whole evaluation is wrapped in try/catch → `false`; an admin-chosen valid IANA id is the normal path, a malformed one denies without leaking (T-55-01-01 mitigation).
- **UTC label fallback** for an unknown IANA id on rehydrate, so the picker always has a valid selection.
- **Intl "24" hour normalization:** midnight can surface as "24" in some engines; normalized to "00" defensively.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. RED→GREEN clean on both TDD tasks; full webapp suite (581 tests, 56 files) green; touched files tsc-clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **55-02 (judge gate, CTFT-10):** imports `isWithinScoreWindow` + `ScoreWindow` from `ctf-score-window.ts` — ready. Insert as judge step 3 (after unlock, before answer validation); closed window = non-solve indistinguishable from a wrong answer (covert invariant preserved).
- **55-03 (admin picker, CTFT-11):** imports `DEFCON_RUN_HOURS`, `TZ_OPTIONS`, and `formStateToScoreWindow`/`scoreWindowToFormState` — ready. Wave-2 plans are file-disjoint and parallel-safe.
- The two pre-existing out-of-scope tsc errors (header/dropdown-user.tsx, entities/__tests__/checkin.test.ts) remain untouched.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/ctf-score-window.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-score-window.test.ts
- FOUND commits: 5bb048ad, 7605151f, f95d1f01, b89a5e8a, 0d3bf59f

---
*Phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating-de*
*Completed: 2026-07-15*
