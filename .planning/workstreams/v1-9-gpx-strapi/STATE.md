---
workstream: v1-9-gpx-strapi
created: 2026-07-05
---

# Project State

## Current Position

**Status:** Phases 1 & 2 EXECUTED & verified (code-complete) — Phase 3 planned, ready to execute
**Current Phase:** Phase 2 done; next is Phase 3 — Strapi POIs on the map
**Last Activity:** 2026-07-05
**Last Activity Description:** Executed Phase 2 (`02-01/02/03`): added `Route.mapFolder`; widened `strapi.ts` to two-part `{ byGpxKey, cmsRoutes }` return; manifest emits standalone `cms-{documentId}` routes into `mapFolder` groups (DynamoDB wins collisions); client-side bounds fallback; CMS-media CloudFront CORS. Studio builds clean (31s), tsc clean. VERIFICATION status: passed (code); functional UAT + .gpx-upload + CORS-deploy remain open. Phase 3 (2 plans) planned + plan-checker PASSED.

## Progress

**Phases Complete:** 2 / 3 (Phases 1 & 2 executed; 3 planned)
**Plans:** Phase 1 ✅ `01-01` · Phase 2 ✅ `02-01/02/03` · Phase 3 `03-01/02` (planned)
**Execution order:** 1 ✅ → 2 ✅ → 3 (Phase 3 fills Phase 2's `strapi.ts`/manifest/`public-overlays.ts` seams)

## Session Continuity

**Stopped At:** Phases 1 & 2 executed & verified. Next: Phase 3 (execute on the CURRENT branch — see branching note).
**Resume File:** `docs/superpowers/specs/2026-07-05-strapi-authored-routes-and-pois-design.md` (design contract)

## Branching (resolved)
Workstream-scoped override `branching_strategy: none` is committed (`.planning/workstreams/v1-9-gpx-strapi/config.json`), so all phases stay on branch **`gsd/phase-01-cms-session-bump`** (which holds every plan + all execution). Global `.planning/config.json` still uses `phase`. The original `gsd/gpx-strapi-routes-pois` is stranded at `5db2a6cf`. Execute Phase 3 on the current branch; do NOT fork off origin/main.

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
