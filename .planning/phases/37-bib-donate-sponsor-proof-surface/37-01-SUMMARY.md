---
phase: 37-bib-donate-sponsor-proof-surface
plan: 01
subsystem: ui
tags: [copy-catalog, strapi, i18n, next, vitest, cms]

# Dependency graph
requires:
  - phase: 36-runtime-copy-toolkit
    provides: loadCopy/resolveCopy server resolver, copy-core t/interpolate, CopyProvider/useCopy, copy-snapshot.json floor
  - phase: 35-cms-copy-catalog-foundation
    provides: Strapi ui-string content type (key/locale/value/namespace), S3 copy.json export
provides:
  - copy-snapshot.json floor holding all 62 bib.* migrated keys (64 total) as the SC-4 source of truth
  - scripts/import-copy.mjs — dependency-free upsert of the snapshot into Strapi via a write token
  - copy:import npm script
  - copy-catalog-bib.test.ts — key-set completeness + interpolation + server->client token-boundary guards
affects: [37-02, 37-03, 37-04, 37-05, 37-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Author committed snapshot as source of truth, then one-shot import into CMS (D-01)"
    - "Dependency-free .mjs CMS tooling using global fetch only (no tsx / no new deps)"
    - "Guard test greps the source tree for a server-only import inside 'use client' files"

key-files:
  created:
    - apps/run.bib/webapp/scripts/import-copy.mjs
    - apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts
  modified:
    - apps/run.bib/webapp/src/lib/copy-snapshot.json
    - apps/run.bib/webapp/package.json

key-decisions:
  - "Split the reconcile note into reconcileNoteBefore/After so the server component keeps <code>{runnerCode}</code> between the halves"
  - "De-duped shared strings (provider note, pill labels, sliderHelper, Payment method, Redirecting, error, cta) authored ONCE under bib.checkout.*"
  - "Import script reads STRAPI_WRITE_TOKEN (write-capable) from env at run time only — distinct from the runtime read-only token; never defaulted/logged/committed"

patterns-established:
  - "Key-set floor test is the Wave-2 contract: a key a downstream plan needs must already resolve here or the test fails first"
  - "Anchored '@/lib/copy\"' specifier match (trailing quote) distinguishes the server resolver from client-safe copy-core"

requirements-completed: [MIGR-01]

coverage:
  - id: D1
    description: "All 62 migrated bib.* keys (64 total incl. 2 retained selftest keys) authored in copy-snapshot.json default map with verbatim wording (SC-4 floor)"
    requirement: MIGR-01
    verification:
      - kind: unit
        ref: "src/__tests__/copy-catalog-bib.test.ts#Test A — bib.* key-set floor (SC-4 contract)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Interpolation tokens present on the interpolated keys (cta {label}/{amount}, sliderHelper {min}/{max}, payVia {provider}, chipAria {amount}/{providers})"
    requirement: MIGR-01
    verification:
      - kind: unit
        ref: "src/__tests__/copy-catalog-bib.test.ts#Test B — interpolation token shape"
        status: pass
    human_judgment: false
  - id: D3
    description: "No 'use client' component imports the server-only @/lib/copy resolver (server->client token boundary, T-37-03)"
    requirement: MIGR-01
    verification:
      - kind: unit
        ref: "src/__tests__/copy-catalog-bib.test.ts#Test C — server->client token boundary (T-37-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "import-copy.mjs upserts the snapshot into Strapi via STRAPI_WRITE_TOKEN; env-less run exits 1 without touching the CMS; copy:import script wired"
    requirement: MIGR-01
    verification:
      - kind: unit
        ref: "node --check scripts/import-copy.mjs && env -u CMS_INTERNAL_URL -u STRAPI_WRITE_TOKEN node scripts/import-copy.mjs (exit 1)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live CMS import round-trip (copy:import against real Strapi with operator write token, then copy:snapshot round-trip)"
    verification: []
    human_judgment: true
    rationale: "Requires the operator's time-limited write token and a live CMS; deferred to the Wave 3 human-verify plan (37-06) per D-01. Not runnable in this autonomous plan."

# Metrics
duration: 12min
completed: 2026-07-06
status: complete
---

# Phase 37 Plan 01: Copy-Catalog Foundation Summary

**Authored the committed source of truth for all 62 bib.* Phase 37 copy keys (64 total in copy-snapshot.json), a dependency-free STRAPI_WRITE_TOKEN import script, and vitest guards for key-set completeness, interpolation shape, and the server->client token boundary.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-06T01:55:00Z
- **Completed:** 2026-07-06T02:07:35Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Authored every migrated `bib.*` string into `copy-snapshot.json` (62 new keys + 2 retained `bib.selftest.*` = 64), verbatim current wording, single-brace interpolation tokens, de-duped shared strings under `bib.checkout.*` (D-01/D-05/D-09) — the SC-4 fallback floor every Wave 2 plan resolves from.
- Created `scripts/import-copy.mjs`: reads the snapshot `default` map and upserts each row into Strapi (`namespace=bib`, `locale=default`) via a write-capable token read only from `process.env.STRAPI_WRITE_TOKEN`; env-less run exits 1 without touching the CMS. Wired `copy:import` npm script.
- Created `copy-catalog-bib.test.ts` with three guards: Test A (key-set floor contract), Test B (interpolation tokens), Test C (no `"use client"` component imports the server-only `@/lib/copy` resolver — T-37-03). All 7 assertions pass on Node v23.6.0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author every bib.* key into copy-snapshot.json** - `3b0572c3` (feat)
2. **Task 2: Key-set completeness + token-boundary test** - `55a8b450` (test)
3. **Task 3: import-copy.mjs upsert script + copy:import npm script** - `ab7eba1e` (feat)

## Files Created/Modified
- `apps/run.bib/webapp/src/lib/copy-snapshot.json` - Extended from 2 to 64 keys; the authored SC-4 floor for all Phase 37 copy.
- `apps/run.bib/webapp/scripts/import-copy.mjs` - Dependency-free one-shot upsert of the snapshot into Strapi via STRAPI_WRITE_TOKEN.
- `apps/run.bib/webapp/package.json` - Added `copy:import` script.
- `apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts` - Key-set / interpolation / token-boundary guards.

## Decisions Made
- Split the SponsorInstructions reconcile note into `reconcileNoteBefore` / `reconcileNoteAfter` so the server component can keep the `<code>{runnerCode}</code>` treatment between the two halves (per 37-CONTEXT specifics).
- Hosted the de-duped shared strings under `bib.checkout.*` (D-09 planner's-call between `bib.checkout.*` and `bib.common.*`).
- Import script uses `STRAPI_WRITE_TOKEN` exclusively; the runtime read-only token name was scrubbed even from code comments so token-safety greps stay unambiguous.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 verify command referenced a not-yet-created Task 2 artifact**
- **Found during:** Task 1 (author snapshot keys)
- **Issue:** The Task 1 `<automated>` verify reads `src/__tests__/copy-catalog-bib.test.ts` into an unused `need` variable; that file is only created in Task 2, so the verify would throw ENOENT purely on plan task-ordering — the read result is never used.
- **Fix:** Ran the meaningful portion of the verify (key count === 64 + anchor keys present); the full guard is exercised by Task 2's vitest which passes.
- **Files modified:** none (verify-only)
- **Verification:** `node -e` key-count check printed `snapshot keys: 64`; Task 2's Test A re-verifies the full key set.
- **Committed in:** covered by 3b0572c3 (Task 1) / 55a8b450 (Task 2)

**2. [Rule 2 - Missing Critical] Scrubbed the read-only token name from import-copy.mjs comments**
- **Found during:** Task 3 (import script)
- **Issue:** Comments explaining the write token mentioned the literal read-only token name, which would false-match a `grep STRAPI_API_TOKEN` token-safety gate and blur the T-37-01 boundary.
- **Fix:** Reworded comments to "runtime read-only catalog token"; the file now references only `STRAPI_WRITE_TOKEN`.
- **Files modified:** apps/run.bib/webapp/scripts/import-copy.mjs
- **Verification:** `grep -c STRAPI_API_TOKEN scripts/import-copy.mjs` → 0; `grep -R STRAPI_WRITE_TOKEN src/` → no matches (script-only).
- **Committed in:** ab7eba1e (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical/security-hygiene)
**Impact on plan:** No scope change. Both keep the plan's own verification gates honest. No new deliverables.

## Issues Encountered
- The repo default Node (v22.1.0) cannot load the ESM vitest config (`ERR_REQUIRE_ESM`). Switched to Node v23.6.0 (project test rule) via nvm; the suite then ran clean.

## User Setup Required
None for this plan. The live CMS import (`copy:import`) needs the operator's time-limited `STRAPI_WRITE_TOKEN` and is deferred to the Wave 3 human-verify plan (37-06) — the script is authored and unit-verified here but NOT run against a live CMS.

## Next Phase Readiness
- Wave 2 plans (37-02..37-05) can now reference any `bib.*` key knowing it resolves from the snapshot floor; the key-set test fails first if a plan needs a key that was not authored.
- Caveat (D-09): `DonateModal.tsx` is byte-for-byte duplicated into run.human and run.flash; migrating run.bib's copy will diverge run.bib's DonateModal from the other two by design — do NOT re-sync the three files after this phase.
- 37-06 (human-verify) must run `copy:import` with the operator write token, then `copy:snapshot` to confirm round-trip.

## Self-Check: PASSED
- FOUND: apps/run.bib/webapp/src/lib/copy-snapshot.json (64 keys)
- FOUND: apps/run.bib/webapp/scripts/import-copy.mjs
- FOUND: apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts
- FOUND commit: 3b0572c3, 55a8b450, ab7eba1e

---
*Phase: 37-bib-donate-sponsor-proof-surface*
*Completed: 2026-07-06*
