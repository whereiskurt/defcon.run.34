# Roadmap: v1.7 GPX Routes — Private Collection, Public Overlay & Strava Sync

**Workstream:** v1-7-gpx-routes
**Parallel-safe with:** v1.5-bib, v1.4.1 (zero file overlap — touches only `apps/run.gpx/` + new infra under `infra/terraform/live/site/services/run.gpx/`)
**Created:** 2026-07-02
**Base branch:** main (post-v1.4/v1.5 in-flight; each phase branches off fresh origin/main)
**Design contract:** `DESIGN.md` (this dir)

## Milestone Goal

gpx.defcon.run becomes the home for everyone's DC34 runs: a private per-user collection
(draw / upload / Strava sync), an admin-curated set of public toggleable map layers
(DEF CON 34 Maps + Rabbit Routes), and a compliant "Convert to public" path so good
routes — including converted Strava runs — can be shared individually and attributably.

## Phases

- [ ] **Phase 28: Public overlay rendering (view)** — `GET /api/gpx/public/maps` (unauth,
  GLOBAL/active only) + studio renders each GLOBAL folder as a read-only layer group
  (group master + per-route toggles); seed "DEF CON 34 Maps". Reqs: GPX-01,02,03.
- [ ] **Phase 29: Admin Publish** — admin-gated "Publish to…" copies an owned route into a
  GLOBAL folder (copy-not-move, `uploadedBy`=owner; 403 for non-admin). Reqs: GPX-04,05.
- [ ] **Phase 30: Request-sharing + curation (Rabbit Routes)** — `shareRequested` flag +
  sparse GSI, "Request sharing" UI, admin curation view → approve copies into "Rabbit
  Routes". Reqs: GPX-06,07,08.
- [ ] **Phase 31: Strava date-banded ingestion + Convert-to-public** — scheduled poll of
  in-window activities → GPX → dedupe into private routes (`source:strava`); explicit
  "Convert to public" mints a shareable `source:converted` copy. Reqs: GPX-09..14.
- [ ] **Phase 32: Aggregate "All Runners" overlay** — opt-in blended non-attributable
  heatmap, single toggle, scheduled rebuild. Reqs: GPX-15.

**Order:** 28 → 29 → 30 → 31 → 32 (29's copy path reused by 30; 32 depends on 31's synced runs).

## Requirements

See `DESIGN.md` → "Requirements (GPX-01 … GPX-15)".

## Success Criteria

Per-phase SCs are enumerated in `DESIGN.md` under each phase heading (SC28.x … SC32.x).
The Strava compliance invariant (GPX-11: no public Strava data without an explicit
"Convert to public" action) is a blocker-class review gate on Phases 31–32.
