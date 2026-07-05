---
gsd_state_version: 1.0
milestone: v1.9
milestone_name: CMS-Driven UI Copy Catalog
current_phase: 36
current_phase_name: Runtime Copy Toolkit
status: verifying
stopped_at: Phase 36 context gathered
last_updated: "2026-07-05T18:06:48.561Z"
last_activity: 2026-07-05
last_activity_desc: Phase 35 complete, transitioned to Phase 36
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-05)

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation. This milestone lets organizers change static UI wording live from the CMS — no code change, no deploy.
**Current focus:** Phase 35 — cms-copy-catalog-foundation

## Current Position

Phase: 36 — Runtime Copy Toolkit
Plan: Not started
Status: Phase complete — ready for verification
Last activity: 2026-07-05 — Phase 35 complete, transitioned to Phase 36

## Roadmap Summary (v1.9)

| Phase | Goal | Requirements |
|-------|------|--------------|
| 35. CMS Copy Catalog Foundation | `ui-string` type + `(key,locale)` uniqueness + API-token read + S3 export hook | COPY-01/02/03/04, FALL-01 |
| 36. Runtime Copy Toolkit | `loadCopy` + Next Data Cache + merged-map `t()` + `CopyProvider`/`useCopy` + cached fallback | TOOL-01/02/03/04/05, FALL-02/03/04 |
| 37. Bib Donate/Sponsor Proof Surface | Wire bib donate/sponsor copy end-to-end (the proof) | MIGR-01 |
| 38. Custom Copy Admin Plugin | Three-column `label·locale·value` admin page + namespace filter + bulk upsert | ADMN-01/02/03 |
| 39. Copy Migration — Remaining Bib + Shared Chrome | Remaining bib copy + shared `common.*` chrome keys | MIGR-02/03 |

Deferred to v2: MIGR-04 (flash/human/auth/gpx migration), I18N-01 (locale population + switcher).

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.9]: Words-only scope — each app keeps its own React header/menu and reads labels by shared `common.*` key; no shared component library
- [v1.9]: No Redis / no revalidation webhook — eventual consistency (~15 min) rides the existing master/worker + Litestream topology + time-based `revalidate:N`
- [v1.9]: Model our own `locale` column (not native Strapi i18n plugin) for the three-column admin grid
- [v1.9]: Fallback must be cached — resolver (Strapi → S3 export → committed snapshot) is wrapped in the Next.js Data Cache so a destroyed CMS never costs a slow failed call per load
- [v1.9]: bib donate/sponsor is the proof surface — hardest case (client-side, interpolated, modal-heavy) validates the whole approach; the plane can land after Phase 37
- [v1.4]: Latest-stable firmware resolved at build time (not runtime) — preserves zero-runtime-dependency guarantee
- [v1.3]: NLB-only for mqtt.defcon.run (no CloudFront -- MQTT is raw TCP)
- [Phase ?]: Kept Strapi attribute name 'locale' despite Strapi reserving it (marked Private, dropped required/default); Plans 02/38 depend on the exact name so drive locale via the Plan 38 custom admin, not the default content-manager
- [Phase ?]: 35-02: (key,locale) uniqueness via lifecycle 4xx guard + idempotent DB unique-index backstop (Litestream-safe hasTable guard)
- [Phase ?]: 35-02: FALL-01 copy.json S3 export is master-only + S3-env-guarded, full-catalog regeneration on every create/update/delete; excludes notes
- [Phase 35]: 35-03: read-only API token auto-covers ui-string find/findOne (no grant widening); verified 200/200/403/403/403/403/403 matrix

### Pending Todos

None.

### Blockers/Concerns

- [v1.4 / Phase 19 — HARDWARE-IN-LOOP]: **tlora-t3s3 flashMode 'dio' boot** — verify the explicit branch (`use-flash.ts:104-106`) produces a bootable tlora-t3s3 device. Only remaining v1.4 open item — Kurt didn't have a tlora-t3s3 during 2026-07-02 hardware verification.

## Session Continuity

Last session: 2026-07-05T18:06:48.553Z
Stopped at: Phase 36 context gathered
Resume file: .planning/phases/36-runtime-copy-toolkit/36-CONTEXT.md

## Operator Next Steps

- Plan the first v1.9 phase with `/gsd-plan-phase 35`

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 33 P01 | 30m | 3 tasks | 7 files |
| Phase 33 P02 | 25min | 3 tasks | 7 files |
| Phase 33 P03 | 12min | 2 tasks | 14 files |
| Phase 33 P04 | ~25m | 2 tasks | 1 files |
| Phase 33 P06 | 8min | 2 tasks | 15 files |
| Phase 35 P01 | 5m | 3 tasks | 5 files |
| Phase 35 P02 | 8m | 3 tasks | 5 files |
| Phase 35 P03 | 6m | 2 tasks | 1 files |
