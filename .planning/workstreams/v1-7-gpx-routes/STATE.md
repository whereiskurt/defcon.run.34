---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: GPX Routes — Private Collection, Public Overlay & Strava Sync
status: Kickoff — workstream created, autonomous execution authorized by Kurt 2026-07-02; starting Phase 28
last_updated: "2026-07-02T17:00:00.000Z"
last_activity: 2026-07-02 — Kurt approved full-autonomy build; workstream scaffolded, phases 28–32 defined (28–31 core, 32 in scope)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# v1.7 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.5-bib
and v1.4.1** — it touches ONLY `apps/run.gpx/` (webapp + vendored gpx-studio + patches)
and new infra units under `infra/terraform/live/site/services/run.gpx/`. Zero file
overlap with `apps/run.bib/` (v1.5) or the flash/firmware paths (v1.4.1).

Full design contract: `.planning/workstreams/v1-7-gpx-routes/DESIGN.md`.

## Current Position

Phase: 28 (Public overlay rendering) — starting
Plan: —
Status: Autonomous build authorized 2026-07-02. Executing PR-per-phase, merge-on-green,
then buildpub.yml on main (per yolo workflow). Ping Kurt in Slack thread when blocked.

## Accumulated Context

### Decisions (Kurt 2026-07-02)

- Both "DEF CON 34 Maps" and "Rabbit Routes" are GLOBAL folders rendered as read-only
  toggleable layer groups (group master toggle + per-route toggles). Model generically.
- Admin (`services.includes("admin")`) Publish copies a route into a GLOBAL folder.
- Community "Request sharing" = `shareRequested` flag → admin curation → copy into Rabbit Routes.
- Copy, not move, everywhere — submitter keeps their original. Attribution via `uploadedBy`.
- Strava ingestion = scheduled polling (not webhook), DATE-BANDED to a configurable
  window (default Black Hat→end of DEF CON, ~2wk); config not hardcoded.
- COMPLIANCE (lawyer-cleared): raw Strava imports are `source:strava`,
  `publicShareEligible:false`, blocked from public until an explicit **"Convert to public"**
  action mints a `source:converted`, `publicShareEligible:true` copy. Then normal sharing applies.
- Phase 32 aggregate "All Runners" overlay is IN SCOPE (product nicety; no longer the
  only compliant path).

### Known constraints / risks

- Public unauth endpoint (Phase 28): cache + rate-limit; short-TTL presigned URLs; GLOBAL/active only.
- Phase 31/32 need new infra (EventBridge worker) → Terraform under run.gpx service units.
- Enforce the Strava conversion invariant in every code review.

## Reuse (already built — do NOT rebuild)

- Admin-gated GLOBAL folders (`POST /api/gpx/folders {isGlobal:true}`, `userId="GLOBAL"`, `uploadedBy`).
- Studio nested layer-group toggle UI (`LayerTreeNode.svelte`, `CustomLayers.svelte`,
  settings stores `currentOverlays`/`selectedOverlayTree`); DEF CON build stripped
  `overlayTree.overlays` to `{}`.
- Strava OAuth linking + tokens (v1.2): `next-auth/providers/strava`, `AUTH_STRAVA_*` in
  SSM `/dc34/secrets/{region}/strava/*`, `hasStrava` session flag, `strava_sync` quota action.
- gpx.studio upload + draw (private routes already fillable two of three ways).
