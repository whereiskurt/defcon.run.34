# v1.8 — GPX Overlay Decoration & User Check-ins

**Status (2026-07-04):** Phases 1–2 SHIPPED on main. Phase 3 built on branch `gsd/gpx-checkins-overlay`, awaiting Kurt's review (v1.8 scope = REVIEW_REQUIRED, no auto-merge).

## What shipped (squash-merged PRs — branches pruned 2026-07-04)

- **Phase 1 — glow styling + click popup**: `gsd/gpx-overlay-decoration` merged to main.
- **Phase 2 — CMS enrichment**: PRs #336/#340 (CMS-curated titles → run-cms-master), #355 (CMS route details + Strava link in popup), #325 (LVCC default zoom), #333 (popup GPX download, fit-on-toggle, tidy names), #358 (legible tooltip + thicker lines, dvh fix).

## Phase 3 — User Check-ins overlay (branch `gsd/gpx-checkins-overlay`, 2026-07-04)

Built per Kurt's 2026-07-03 decisions (public map shows only `isPrivate === false`
check-ins, WITH display names — explicitly OK'd):

1. **run.human** `GET /api/checkins/public` (no auth) — pages `byGlobalRecent` GSI
   (caps: 200 returned / 1000 scanned), filters `isPrivate === false`, joins
   `RunUser.displayName` (fallback "a rabbit"), projects only
   `{lat, lon, displayName, timestamp, checkInType}`. Vitest coverage incl.
   a no-userId-leak projection test (`vitest.config.mts` added for the `@/` alias).
2. **run.gpx** `GET /api/gpx/public/checkins` — same-origin proxy over ECS service
   discovery; `RUN_HUMAN_INTERNAL_URL` added to `run.gpx/service.hcl` (needs a
   terragrunt apply + redeploy to take effect).
3. **Studio** — "User Check-ins" toggle in the layer control: clustered teal/magenta
   pins (`public-overlays.ts`), click pin → displayName + time popup, click cluster
   → expansion zoom.
4. **Bonus (Phase 2 leftover)** — route GPX waypoints (POIs) now render as small
   branded icons (`getSvgForSymbol`, colored per route) with a name/desc popup,
   showing/hiding with their route's toggle.

Verified: `./build-frontend.sh` exit 0; `svelte-check` errors all pre-existing
(none in touched files); `tsc --noEmit` clean in both webapps; 15/15 vitest pass.
VISUALLY VERIFIED locally 2026-07-04 (full recipe + new `run.human/webapp/scripts/
seed-local-checkins.mts`): clustered pins with counts, cluster styling, pin popup
(🐇 name · time · type), private check-ins excluded (9/11), glow route, POI icons
+ popups, fit-on-toggle. Also: elevation pane now collapsed by default (Kurt ask).

## Remaining / follow-ups

- Deploy Phase 3 (PR #368 merged 2026-07-04): buildpub → deploy run.human AND
  run.gpx images + terragrunt apply for `RUN_HUMAN_INTERNAL_URL`.
- **Phase 4 — SPEC APPROVED, ready to plan/build:** custom check-in pins
  (curated icons + any color w/ DC34 swatches, services-gated secret pins,
  profile default + per-check-in override) + time chips + runner highlight.
  Full spec: [PHASE-4-PINS-FILTERS.md](PHASE-4-PINS-FILTERS.md). Branch off
  main, new PR.
- Later: unlock codes for secret pins, time-lapse mode, leaderboard, live
  refresh, POI photo popups (CMS `pois` — see FUTURE-ENRICHMENT in v1.7).

### Reference (verify before trusting — see memory `project_gpx_public_overlay.md`)
- Real DynamoDB table for run.gpx = `run-gpx-electro` (NOT the entity default `dc34-gpx`).
- App AWS account 427284555693 (profiles `dc34-application`/`dc34-terraform`); mgmt 481723467561.
- Deploy: buildpub (bump PAST existing ECR tags — immutable-tag drift) → deploy.yml `pr_number=latest`. Cluster `app-use1-dc34`, service `run-gpx-use1`.
