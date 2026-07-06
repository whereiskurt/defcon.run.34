---
phase: 39-copy-migration-remaining-bib-shared-chrome
plan: 06
subsystem: ui
tags: [copy-catalog, guard-test, fallback, strapi, run.bib, run.human, verification]

# Dependency graph
requires:
  - phase: 39-03
    provides: run.bib chrome reads common.* keys
  - phase: 39-04
    provides: run.bib remaining prose (bib.txn.* / bib.admin.*) reads catalog keys
  - phase: 39-05
    provides: run.human chrome reads the SAME common.* keys (SC-3 live surface)
provides:
  - Cross-snapshot common.* byte-equality assertion in BOTH apps' copy-catalog guard tests (D-07 invariant locked; drift = red test in both apps)
  - Verified production builds for both apps with CMS unreachable (FALL-04 build gate)
  - Offline FALL-04 content proof — both apps' snapshot floors render every common.* as a real word, never {} / never a raw dotted key
  - Static SC-2 wiring evidence — both apps reference the identical common.* key set
affects: [MIGR-04, copy-usage-index]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-app snapshot floor guarded by reading the sibling app's copy-snapshot.json off disk (node:fs, no bundler alias) and deep-equalling the common.* subset — divergence is a red test in BOTH suites"

key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts
    - apps/run.human/webapp/src/lib/__tests__/copy-catalog-human.test.ts

key-decisions:
  - "Guard reads the sibling snapshot directly from disk (node:fs + resolve from import.meta.url) rather than a bundler alias — the cross-app file is outside each app's @/ root, and fs matches the existing Test-C pattern"
  - "Assertion guards against a vacuous pass — both floors must carry >0 common.* keys before the deep-equality check"
  - "Live operator import + SC-3 cross-app edit + live SC-1/SC-2 visual verify remain a human-action checkpoint (write token + live prod required; no token available in this autonomous run)"

patterns-established:
  - "Shared-floor byte-equality invariant enforced symmetrically in both consumer apps' test suites"

requirements-completed: []

coverage:
  - id: D1
    description: "Cross-snapshot common.* deep-equality assertion added to both guard tests; drift becomes a red test in both apps (D-07)"
    requirement: "MIGR-02, MIGR-03"
    verification:
      - kind: unit
        ref: "apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts (Test D) — 10 passed"
        status: pass
      - kind: unit
        ref: "apps/run.human/webapp/src/lib/__tests__/copy-catalog-human.test.ts (Test D) — 4 passed"
        status: pass
      - kind: other
        ref: "Negative proof: mutating run.human common.header.maps turned bib Test D RED, then git-restored"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both apps' common.* snapshot subsets are byte-identical (diff prints nothing)"
    requirement: "MIGR-03"
    verification:
      - kind: other
        ref: "diff of sorted common.* JSON subsets between the two snapshots — IDENTICAL"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both apps build with CMS unreachable (FALL-04 build gate)"
    requirement: "MIGR-02, MIGR-03"
    verification:
      - kind: integration
        ref: "npx next build (run.bib) with CMS_INTERNAL_URL/STRAPI_API_TOKEN unset — 15/15 static pages generated, exit 0"
        status: pass
      - kind: integration
        ref: "npx next build (run.human) with CMS unset — Compiled successfully, 17/17 static pages generated, exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "FALL-04 content proof — CMS-down fallback renders every common.* from the snapshot floor, never {} / raw dotted key"
    requirement: "FALL-04"
    verification:
      - kind: other
        ref: "Offline replica of resolveCopy (strapi={}, s3={}) + copy-core.t over both floors — 17 common.* keys each, 0 raw-dotted/empty renders (e.g. common.header.maps -> 'Maps', common.profileMenu.signOut -> 'Sign out')"
        status: pass
    human_judgment: false
  - id: D5
    description: "SC-2 static wiring — both apps' chrome reference the identical common.* key set from the shared catalog"
    requirement: "MIGR-03"
    verification:
      - kind: other
        ref: "grep common.* across bib {header,menu-dropdown,user-dropdown,footer} + human {header/*,footer} — same key namespace in both"
        status: pass
    human_judgment: false
  - id: D6
    description: "SC-1 / SC-2 LIVE renders + SC-3 live cross-app common.* edit + FALL-04 live fallback — operator-pending (write token + live prod)"
    verification: []
    human_judgment: true
    rationale: "Requires an operator-supplied write-capable STRAPI_WRITE_TOKEN to run copy:import against the live catalog, then a live edit of one shared common.* row confirmed in BOTH bib.defcon.run and run.defcon.run — no token / live prod access in this autonomous run"

# Metrics
duration: 4min
completed: 2026-07-06
status: blocked
---

# Phase 39 Plan 06: Verify + Lock Shared Copy Floor Summary

**Locked the two apps' `common.*` snapshot floors to cross-app byte-equality (a red test in BOTH suites on any drift), proved both apps build and fall back to real words with the CMS unreachable (FALL-04), and staged the exact operator steps for the one part that needs a live write token — the SC-3 cross-app CMS edit.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-06T16:38:18Z
- **Completed (auto portion):** 2026-07-06T16:42:31Z
- **Tasks:** 2 (Task 1 complete; Task 2 auto-portion complete, live portion = operator checkpoint)

## What Was Verified Automatically (no token, no network)

### Task 1 — cross-snapshot common.* byte-equality lock (COMPLETE)
- Added **Test D** to both `copy-catalog-bib.test.ts` and `copy-catalog-human.test.ts`: each test reads the **sibling app's** `copy-snapshot.json` straight off disk (node:fs, resolved from `import.meta.url` — no bundler alias, since the cross-app file is outside each app's `@/` root), extracts the sorted `common.*` subset, and asserts deep-equality against the local floor. A vacuous-pass guard requires both floors to carry >0 `common.*` keys first.
- **Result:** run.bib suite **10 passed**, run.human suite **4 passed** (node v23.6.0 — v22 hits the documented ERR_REQUIRE_ESM in vitest.config.ts).
- **Negative proof:** temporarily mutating `run.human`'s `common.header.maps` to `"Maps-DRIFTED"` turned **bib Test D RED** (`× byte-identical common.* subset`), then the snapshot was `git checkout`-restored to `"Maps"`. Drift is now a red test in both apps (D-07 invariant enforced symmetrically).
- **Acceptance diff:** the sorted `common.*` JSON subsets of the two snapshots `diff` to **nothing** (IDENTICAL) — 17 keys each.

### Task 2 — automatable parts (COMPLETE)
- **Build gate (FALL-04 build):** with `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` unset, `npx next build` succeeds in **both** apps — run.bib generated 15/15 static pages (exit 0); run.human "Compiled successfully" + 17/17 static pages (exit 0). No build crash on a missing catalog.
- **FALL-04 content proof (offline):** a faithful replica of the toolkit fallback (`resolveCopy` with `strapi={}`, `s3={}` → merged map == snapshot floor) driven through `copy-core.t`'s exact `map[key] ?? key` semantics over **both** floors — every one of the 17 `common.*` keys resolves to a real word (`common.header.maps` → `"Maps"`, `common.profileMenu.signOut` → `"Sign out"`), **0** raw-dotted/empty/`{}` renders. This is the CMS-down guarantee: `t()` echoes the dotted key only when the map lacks it, and the snapshot floor never lacks a `common.*` key.
- **SC-2 static wiring:** grep confirms `run.bib` chrome (`header.tsx`, `menu-dropdown.tsx`, `user-dropdown.tsx`) and `run.human` chrome (`header/header.tsx`, `header/dropdown-menu.tsx`, `header/dropdown-user.tsx`, `footer.tsx`) reference the **same** `common.header.*` / `common.profileMenu.*` / `common.footer.*` namespace — both apps read the identical shared keys (the SC-3 surface). `run.bib` remaining prose reads `bib.txn.*` / `bib.admin.*` (39-04) with no raw dotted keys.

## What Remains — OPERATOR HUMAN-ACTION (cannot be automated here)

The live proof requires a **write-capable** `STRAPI_WRITE_TOKEN` (distinct from the runtime read-only token) and live prod access — neither is available in this autonomous background run, and a token must never be fabricated. Exact steps are in the `## CHECKPOINT` returned to the orchestrator:
1. Export `CMS_INTERNAL_URL` + `STRAPI_WRITE_TOKEN` (write token, never committed), run `npm run copy:import` in `apps/run.bib/webapp` AND `apps/run.human/webapp` — each prints a created/updated tally and exits 0. Namespace is derived per key (`common.*` → `common`, `bib.*` → `bib`), so one import seeds both shared chrome and bib-specific rows; upsert is idempotent by key.
2. **SC-1 / SC-2 live:** load bib.defcon.run + run.defcon.run — chrome/prose show normal words, no raw dotted keys.
3. **SC-3 (headline de-dup proof):** edit ONE shared `common.*` row in the Strapi Copy Catalog admin (e.g. `common.header.maps` "Maps" → "Maps!"), wait ~5 min (revalidate window), confirm the change appears in **BOTH** apps with no deploy / no shared component. **Revert the row after.**
4. **FALL-04 live:** with the CMS unreachable, confirm both apps still render chrome from the snapshot floor.

## Task Commits

1. **Task 1: Lock shared common.* snapshot floor to cross-app byte-equality** — `73fa1adb` (test)
2. **Task 2 (auto portion):** verification-only — no source change to commit (builds/tests/offline proof captured above); live portion pending operator.

## Files Created/Modified
- `apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts` — added Test D (cross-snapshot common.* deep-equality; reads run.human snapshot off disk)
- `apps/run.human/webapp/src/lib/__tests__/copy-catalog-human.test.ts` — added Test D (cross-snapshot common.* deep-equality; reads run.bib snapshot off disk)

## Deviations from Plan

None — plan executed as written for the automatable scope. The live operator import + SC-3/SC-1/SC-2/FALL-04 live verification is a planned `checkpoint:human-verify` (gate="blocking") deliberately surfaced as a human-action checkpoint because this autonomous run has no write token and no live-prod access.

## Threat Notes
- T-39-13 (write-token disclosure) is unchanged: the import path was NOT run here (no token). The `import-copy.mjs` script reads `STRAPI_WRITE_TOKEN` at run time only, never logs/echoes the token, and exits 1 if either env var is missing (no half-import). The operator checkpoint gates the write path.
- No new dependencies added (T-39-SC honored — assertions only).

## Known Stubs
None — Task 1 shipped real assertions; no placeholder/empty-value code introduced.

## Issues Encountered
- node v22.1.0 hits `ERR_REQUIRE_ESM` loading `vitest.config.ts` (std-env `.mjs`); switched to node v23.6.0 per the documented project constraint — tests then pass.

## User Setup Required
- **strapi-cms:** operator must export a write-capable `STRAPI_WRITE_TOKEN` + `CMS_INTERNAL_URL` and run `npm run copy:import` in both apps, then perform the live SC-3 edit (see CHECKPOINT). Token is import-time only — never committed, never added to runtime env.

## Next Phase Readiness
- The shared-floor invariant is now guarded in both suites; MIGR-04 (run.auth/run.flash chrome, run.human deep surfaces) can extend the same pattern.
- Once the operator confirms the live SC-3 edit + FALL-04 live fallback, phase 39 is fully proven and can close.

## Self-Check: PASSED
- `apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts` — FOUND (Test D present, 10 tests pass)
- `apps/run.human/webapp/src/lib/__tests__/copy-catalog-human.test.ts` — FOUND (Test D present, 4 tests pass)
- Commit `73fa1adb` — FOUND in git log on gsd/phase-39-copy-migration-remaining-bib-shared-chrome

---
*Phase: 39-copy-migration-remaining-bib-shared-chrome*
*Completed (auto portion): 2026-07-06 — live SC-3 proof operator-pending*
