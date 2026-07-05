---
workstream: v1-9-gpx-strapi
created: 2026-07-05
---

# Project State

## Current Position

**Status:** ✅ ALL 3 PHASES EXECUTED & verified (code-complete) — workstream done; needs run.cms/gpx deploy + UAT
**Current Phase:** None — milestone complete (3/3)
**Last Activity:** 2026-07-05
**Last Activity Description:** Executed Phase 3 (`03-01/02`): `strapi.ts` populates `pointsOfInterest`; manifest nests `pois` for standalone + enriched routes; studio renders POI icons (markerImage else all-12 `poiType` defaults) with a cross-origin loader + SVG fallback (Risk 3) and an escaped photo popup (colored left tab), riding the existing per-route POI layer (toggle with route). Studio builds clean, tsc clean. VERIFICATION status: passed (code). Milestone v1.9 GPX code-complete.

## Progress

**Phases Complete:** 3 / 3 ✅ (all executed & verified — code-complete)
**Plans:** Phase 1 ✅ `01-01` · Phase 2 ✅ `02-01/02/03` · Phase 3 ✅ `03-01/02`
**Execution order:** 1 ✅ → 2 ✅ → 3 ✅

## Session Continuity

**Stopped At:** All phases executed & verified (code-complete). Branch `gsd/gpx-strapi-routes-pois` (consolidated; the redundant phase-01 branch was deleted).
**Resume File:** `docs/superpowers/specs/2026-07-05-strapi-authored-routes-and-pois-design.md` (design contract)

## ⛳ Remaining to ship (not code — deploy + UAT)
1. **Push** branch `gsd/gpx-strapi-routes-pois` and open a PR (not yet pushed).
2. **Deploy run.cms** — activates the 2h admin session (Phase 1) AND the CMS-media CloudFront CORS (Phase 2, `main.tf`) needed for cross-origin `.gpx` + marker-image fetch. `terragrunt plan/apply` on the cms region(s).
3. **Deploy run.gpx** — ships the manifest (`strapi.ts`/`route.ts`) + rebuilt studio bundle (`public-overlays.ts`) so CMS routes + POIs render publicly.
4. **`.gpx` upload check (Phase 2 / 02-01):** one-time manual — `npm run develop` at :1337, upload a `.gpx` into `Route.gpxFiles`; whitelist `config/plugins.ts` (gpx/xml mimes) only if rejected.
5. **Functional UAT:** author a CMS Route (GPX + POIs) → confirm it appears under its `mapFolder` group, no double-render on `gpxFileId` collision, fits on toggle, POIs show as icons + photo popups and toggle with the route.
6. **Optional:** `/gsd-ui-phase 2`/`3` for a formal UI-SPEC (skipped — visual direction was locked in design D7/D8).

## Branching (resolved)
Workstream-scoped override `branching_strategy: none` is committed (`.planning/workstreams/v1-9-gpx-strapi/config.json`), so all phases stay on branch **`gsd/gpx-strapi-routes-pois`** (which holds every plan + all execution). Global `.planning/config.json` still uses `phase`. The original `gsd/gpx-strapi-routes-pois` is stranded at `5db2a6cf`. Execute Phase 3 on the current branch; do NOT fork off origin/main.

## Open notes for execution
- **Phase 1 deploy:** the 2h session only activates after a **run.cms release/deploy** (restart the Strapi task). Out of scope for the phase; schedule separately.
- **UI safety gate was skipped (`--skip-ui`) for Phases 2 & 3** — reuse existing patterns; visual direction locked in design contract D7/D8. Run `/gsd-ui-phase 2` / `3` if a formal UI-SPEC is wanted.
- **Phase 2 open items (from plans):** actually perform/record the local-Strapi `.gpx` upload check (02-01); the CMS-media CORS change (02-03) is code-only until deployed.
- **Cross-phase seam:** Phase 2 refactors `fetchRouteMeta` → `{ byGpxKey, cmsRoutes }`, stubs `PoiMeta`/`pois: []`, adds `PublicMap.pois?`, adds cms CloudFront CORS. Phase 3 fills those seams. Execute 2 before 3.

## Open notes for execution
- **UI safety gate was skipped (`--skip-ui`) for Phases 2 & 3** — both touch the public map frontend but reuse existing patterns (`getSvgForSymbol`, existing popup builder, existing per-route POI layer); visual direction is locked in design contract D7/D8. No UI-SPEC.md generated. Regenerate with `/gsd-ui-phase 2` / `3` if a formal design contract is wanted.
- **Phase 2 advisory warnings (non-blocking):** (1) `02-02` tasks labeled `tdd="true"` but verify is grep+typecheck only — add a unit test for collision/folder-synthesis/ordering or drop the label; (2) `02-01` `.gpx`-upload verify is structural — executor must actually perform/record the observational Strapi upload; (3) `02-03` CORS verify is `terraform fmt` only (deploy out of scope).
- **Cross-phase seam:** Phase 2 refactors `fetchRouteMeta` → `{ byGpxKey, cmsRoutes }`, stubs `PoiMeta`/`pois: []`, adds `PublicMap.pois?`, and adds cms CloudFront CORS. Phase 3 fills those seams. Execute 2 before 3.

## Notes

- Isolated workstream in worktree `.claude/worktrees/gpx` on branch `gsd/gpx-strapi-routes-pois`.
  Parallel-safe with `v1-8-bib-admin` (which owns the shared `.planning/phases/` + STATE — do
  NOT run destructive milestone resets from this worktree).
- Phase numbering is local to this workstream (1/2/3), matching the `v1-8-gpx-decoration` pattern.
- Run GSD commands with `--ws v1-9-gpx-strapi`.
