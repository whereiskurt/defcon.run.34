---
workstream: v1-9-gpx-strapi
created: 2026-07-05
---

# Project State

## Current Position

**Status:** Phase 1 EXECUTED & verified (code-complete) — Phases 2 & 3 planned, ready to execute
**Current Phase:** Phase 1 done; next is Phase 2 — Standalone Strapi routes
**Last Activity:** 2026-07-05
**Last Activity Description:** Executed Phase 1 (`01-01`): bumped CMS admin refresh lifespan defaults 600→7200s in `apps/run.cms/app/config/admin.ts`; access token stays 300s; confirmed no infra env override. VERIFICATION status: passed. Phases 2 (3 plans) & 3 (2 plans) planned + plan-checker PASSED (Phase 2 advisory warnings addressed).

## Progress

**Phases Complete:** 1 / 3 (Phase 1 executed; 2 & 3 planned)
**Plans:** Phase 1 ✅ `01-01` (done) · Phase 2 `02-01/02/03` (planned) · Phase 3 `03-01/02` (planned)
**Execution order:** 1 ✅ → 2 → 3 (Phase 3 consumes Phase 2's `strapi.ts`/manifest/`public-overlays.ts` seams)

## Session Continuity

**Stopped At:** Phase 1 executed & verified. Next: `/gsd-execute-phase 2 --ws v1-9-gpx-strapi` (see branching note below first).
**Resume File:** `docs/superpowers/specs/2026-07-05-strapi-authored-routes-and-pois-design.md` (design contract)

## ⚠ Branching note for executing Phases 2 & 3
All planning + Phase 1 execution landed on branch **`gsd/phase-01-cms-session-bump`** (the first
Phase 1 planner subagent auto-created it from the `phase_branch_template` config and switched to it;
the original `gsd/gpx-strapi-routes-pois` is stranded at the first plan commit `5db2a6cf`). Because
`branching_strategy: "phase"`, running `/gsd-execute-phase 2` will try to fork `gsd/phase-02-…` off
`origin/main` — which does NOT contain the workstream ROADMAP or the Phase 2/3 plan files. Before
executing Phase 2, either (a) set `branching_strategy: "none"` for this workstream so execution stays
on the current branch, or (b) create the phase-02 branch off the current branch (which has the plans),
not origin/main. Do NOT let it fork off main.

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
