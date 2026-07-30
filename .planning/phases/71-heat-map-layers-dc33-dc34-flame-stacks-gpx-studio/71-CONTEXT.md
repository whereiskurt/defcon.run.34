# Phase 71: Heat Map Layers — DC33 + DC34 Flame Stacks - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning (after Phase 70 executes)
**Source:** Brainstorm with Kurt 2026-07-30 (design approved verbally: "Sounds right")

<domain>
## Phase Boundary

Per-year heat-map layers (DC33 + DC34) in the gpx studio, DC33-faithful stacked-flame
style, fed by a precomputed S3 artifact pipeline with a visible "last calculated" stamp.
UI slots into the Phase 70 Map Layers dialog. Standalone /heatmap page, stats overlays,
Konami flair, per-day filtering, and heatmap-kernel rendering are out of scope.
</domain>

<decisions>
## Implementation Decisions (all user-locked 2026-07-30)

### Rendering — "DC33-faithful stacked lines" (chosen over kernel heatmap and hybrid)
- Each run = one translucent line; overlap = heat. DC34 flame red `#ff0000`, DC33 ember
  orange `#ff8c00`, ~25% opacity, width ~3. Both layers can be on simultaneously.
- DC33 reference: `~/working/defcon.run.33/apps/nx/apps/webapp/src/app/api/heatmap/route.ts`
  styled `color:'#ff0000', opacity:0.7, weight:4` per activity, grouped `DC${n}` layers.
  (Their 0.7 was Leaflet-per-activity; tune ours ~0.25 in Mapbox for taste — Claude's discretion.)

### Data source — "All submitted runs" (chosen over opt-in-only and split)
- EVERY con-day-assigned run with geometry counts: GpxFile S3 tracks + accomplishment /
  Strava `summary_polyline`s. NO includeInAggregate gate.
- ⚠️ This consciously SUPERSEDES the compliance comment in
  `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` ("the only public
  surface permitted for Strava-derived routes" / opt-in). Kurt decided with that context
  explicitly presented. HEAT-06 requires updating that comment so the codebase tells one
  story. Output stays non-attributable (bare geometry, zero properties).

### Artifact pipeline
- Per-year artifact in S3: GeoJSON FeatureCollection of bare LineStrings + sidecar/embedded
  `meta {generatedAt, runCount, totalKm}`.
- DC34: scheduled builder, EventBridge pattern per the existing gpx Strava sync
  (memory: project_gpx_strava_strip — EventBridge + VPC Lambda; scheduler:* was missing
  from CI role once, check), hourly during the con window.
- DC33: ONE-OFF backfill from the DynamoDB export at
  `s3://defcon.run.33.backup/AWSDynamoDB/01755225714347-c2695bcb/` (verified 2026-07-30:
  4 gz data files, 730 items; sampled file = 118 Accomplishments / 50 with non-empty
  `metadata.summary_polyline`; DYNAMODB_JSON format; export taken 2025-08-15, table
  `electro-use1-run-defcon-run` acct 427284555693). `generatedAt` = export date (honest).
  DC33 polylines may be encoded polyline OR JSON coordinate arrays (manual uploads) —
  DC33's route.ts handles both; port that handling.
- Serve via `/api/gpx/public/heatmap/{dc33|dc34}` (unauthenticated, CDN-cached like the
  aggregate route's Cache-Control pattern). Studio never reads DynamoDB.

### Studio layer + UI
- `heatmap-layer.ts` in `lib/components/map/` following rabbit-layer/deuce-layer lazy
  `setVisible` pattern; default OFF; fetch artifact on first enable.
- HEAT MAP section in the Phase 70 Map Layers dialog (shared Section component):
  rows `🔥 DC34 — live` and `🔥 DC33 — the classic`; section trailing slot shows relative
  "last calculated" (e.g. "42m ago"); hint bar shows exact timestamp + run count on hover.
- DEPENDS ON Phase 70 (Section + HintBar kit, dialog). Plan/execute after 70 ships.

### Claude's Discretion
- Exact opacity/width tuning, artifact meta placement (embedded vs sidecar), dedup rule
  when a run has both GPX track and Strava polyline (prefer GPX track), con-window
  schedule expression, whether DC33 backfill runs locally-once vs as a Lambda.
</decisions>

<canonical_refs>
## Canonical References

- `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` — artifact shape precedent (bare LineStrings, trkptCoords, Cache-Control) + the compliance comment HEAT-06 updates
- `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts` / `deuce-layer.ts` — layer class pattern
- `~/working/defcon.run.33/apps/nx/apps/webapp/src/app/api/heatmap/route.ts` — DC33 polyline decode (both formats) + per-year grouping (OUTSIDE this repo — copy logic, don't import)
- `s3://defcon.run.33.backup/AWSDynamoDB/01755225714347-c2695bcb/` — DC33 data (read-only; use the 2025-08-14 export, NOT the earlier 08-09 one)
- Phase 70 artifacts: `.planning/phases/70-*/70-*.md` + `.planning/sketches/006-shared-dialog-shell/` — Section/HintBar contracts
</canonical_refs>

<specifics>
## Specific Ideas

- "Last calculated" was an explicit user ask — it must be visibly on the layer UI.
- "dc33 and dc34 heatmap simultaneously = legendary" — the two-color simultaneous view is
  the emotional core of the feature; verify it visually in the ship probe.
- ⚠️ DC33 repo `.env` contains dead IAM keys (verified InvalidClientTokenId 2026-07-30) —
  already flagged to Kurt; sudo-management profile is stale (SSO grants ReadOnly not Admin
  on 481723467561).
</specifics>

<deferred>
## Deferred Ideas

- Standalone /heatmap page with DC33's Konami wrapper + matrix rain + stats overlay
- Per-con-day heat filtering; heatmap-kernel glow variant (artifact format supports later)
</deferred>

---

*Phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio*
*Context gathered: 2026-07-30 via brainstorm (design approved)*
