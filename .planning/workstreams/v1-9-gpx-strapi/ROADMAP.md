# Roadmap: v1.9 GPX — Strapi-Authorable Routes & POIs

**Workstream:** v1-9-gpx-strapi
**Parallel-safe with:** v1-8-bib-admin and all bib/flash workstreams (touches only `apps/run.gpx/`, `apps/run.cms/`, and possibly infra env for run.cms — zero overlap with `apps/run.bib/` or flash paths)
**Created:** 2026-07-05
**Base branch:** `gsd/gpx-strapi-routes-pois` (off latest `main`; each phase may branch off fresh)
**Design contract:** `docs/superpowers/specs/2026-07-05-strapi-authored-routes-and-pois-design.md` (approved) — decisions D1–D9, edge cases, and build-time risks live there.

## Milestone Goal

Let curators (Jesse & co.) author DEF CON run content **entirely in Strapi** and have it
appear on the public map: a Strapi `Route` that carries its own GPX renders as a first-class
route, and its related `point-of-interest` records render as icons with popups — so a fully
CMS-authored route (GPX + POIs + photos) appears and toggles as one unit. The existing PUBLIC
mechanism (admin publish + user "Rabbit Routes", DynamoDB + S3) is untouched; Strapi flips from
a right-join *enricher* to *also a left source*. Plus a small operational fix: bump the CMS
admin session from ~10 min to ~2 h.

## Phases

- [x] **Phase 1: CMS session bump** — raise the Strapi admin session (`config/admin.ts`
  `maxRefreshTokenLifespan` + `idleRefreshTokenLifespan`) from 600s to 7200s (2h); keep the
  5-min access token; verify no Terragrunt/ECS env pins the old lifespans. Independent,
  smallest, shippable alone. Reqs: GPXCMS-01. **(DONE 2026-07-05 — code-complete; needs run.cms deploy to activate)**
- [x] **Phase 2: Standalone Strapi routes** — add free-text `Route.mapFolder` (default
  "DEF CON 34 Maps"); widen `strapi.ts` (`gpxFileId notNull OR gpxFiles notNull`, populate
  `gpxFiles`/`mapFolder`); manifest emits standalone routes (`fileId: "cms-{documentId}"`,
  CMS media `downloadUrl`) folded into the `mapFolder` group; DynamoDB wins `gpxFileId`
  collisions; client-side bounds fallback for fit-on-toggle. Verify CMS `.gpx` CORS + Strapi
  `.gpx` upload whitelist. Reqs: GPXCMS-02..05. **(DONE 2026-07-05 — code-complete; studio builds clean; open: functional UAT, .gpx-upload check, CORS deploy)**
- [ ] **Phase 3: Strapi POIs on the map** — `strapi.ts` populates `pointsOfInterest`; manifest
  nests `pois` per route; studio renders POI icons (`markerImage` when present, else a
  `poiType`-based default) with a popup (`name` + `description` + `photo`, colored left tab in
  the route color) in the existing per-route POI layer so POIs toggle with their route. Verify
  marker-image cross-origin. Reqs: GPXCMS-06..09.

**Order:** 1 → 2 → 3. Phase 1 is fully independent. Phase 3 depends on Phase 2's `strapi.ts`
/ manifest / `public-overlays.ts` changes, so run 2 before 3 (or coordinate those shared files
if parallelized as waves).

### Phase 1: CMS session bump

**Goal:** Raise the Strapi admin session lifespan from 600s to 7200s (2h) so CMS editors
(Jesse & co.) stay logged in for a realistic authoring session instead of being bounced to
OIDC every ~10 minutes. Change the `config/admin.ts` defaults for `maxRefreshTokenLifespan`
and `idleRefreshTokenLifespan` (both `env.int`-overridable) from `600` to `7200`; keep the
5-minute access token (`ADMIN_ACCESS_TOKEN_LIFESPAN` = 300) unchanged. Confirm no Terragrunt/
ECS task-definition env pins the old `600` values (if pinned, the code default has no effect).
Tradeoff accepted per design decision D9: CMS access-revocation latency grows to ~2h.

**Depends on:** None (branches off `gsd/gpx-strapi-routes-pois`; fully independent, shippable alone)

**Requirements:** GPXCMS-01

**Success Criteria:** See "Phase 1" under Success Criteria below — editor stays logged in ~2h;
`config/admin.ts` defaults are 7200s for max + idle refresh; deployed env confirmed not to override.

**Plans:** 1/1 plan complete
- [x] 01-01-PLAN.md — Bump admin refresh lifespan defaults to 7200s (2h) + verify no infra env override (commits `9f353913`, `554fa7b7`)

**UI hint:** no (config-only backend change, no frontend surface)

### Phase 2: Standalone Strapi routes

**Goal:** Let a published Strapi `Route` with an attached GPX (and no matching GLOBAL DynamoDB
route) render as a first-class route on the public map, sourced from the CMS media GPX. Add a
free-text `Route.mapFolder` field (default "DEF CON 34 Maps"); widen `strapi.ts` to filter
`gpxFileId notNull OR gpxFiles notNull` and populate `gpxFiles`/`mapFolder`; emit standalone
routes into the manifest (`fileId: "cms-{documentId}"`, CMS media `downloadUrl`) folded into the
`mapFolder` group (synthesized if absent); DynamoDB wins `gpxFileId` collisions (no double-render);
add a client-side bounds fallback so fit-on-toggle works without precomputed bounds. Verify CMS
`.gpx` CORS + Strapi `.gpx` upload whitelist.

**Depends on:** None for build (Phase 1 is independent); Phase 3 depends on this phase's
`strapi.ts` / manifest / `public-overlays.ts` changes.

**Requirements:** GPXCMS-02, GPXCMS-03, GPXCMS-04, GPXCMS-05

**Success Criteria:** See "Phase 2" under Success Criteria below.

**Plans:** 3 plans
- [ ] 02-01-PLAN.md — CMS authoring surface: add Route.mapFolder (default "DEF CON 34 Maps") + verify/whitelist .gpx upload (GPXCMS-02, Risk 2)
- [ ] 02-02-PLAN.md — Standalone route data contract: widen strapi.ts (filter/populate/return) + manifest emission, mapFolder grouping, DynamoDB-wins collisions (GPXCMS-03, GPXCMS-04)
- [ ] 02-03-PLAN.md — Studio rendering + delivery: client-side bounds fallback + CMS-media CORS for the studio origin (GPXCMS-05, Risk 1)

**UI hint:** yes (public map rendering — new route layer source path)

### Phase 3: Strapi POIs on the map

**Goal:** Render a route's related `point-of-interest` records as icons with popups on the public
map, toggling together with their route. Populate `pointsOfInterest` in `strapi.ts`; nest `pois`
per route in the manifest; render POI icons in studio (`markerImage` when present, else a
`poiType`-based default icon/color) with a click popup (`name` + `description` + `photo`, colored
left tab in the route color) in the existing per-route POI layer so POIs show/hide with the route.
Verify marker-image cross-origin loading.

**Depends on:** Phase 2 (shared `strapi.ts` / manifest / `public-overlays.ts` changes)

**Requirements:** GPXCMS-06, GPXCMS-07, GPXCMS-08, GPXCMS-09

**Success Criteria:** See "Phase 3" under Success Criteria below.

**Plans:** 2 plans
- [ ] 03-01-PLAN.md — POI data path: strapi.ts populates pointsOfInterest + fills pois; manifest nests pois on standalone AND enriched routes (GPXCMS-06)
- [ ] 03-02-PLAN.md — Studio POI rendering: poiType→icon/color map, markerImage (cross-origin) with fallback, rich photo popup, toggles with the route via the per-route POI layer (GPXCMS-06..09)

**UI hint:** yes (POI icons + popups on the public map)

## Requirements

### CMS Session (Phase 1)
- [ ] **GPXCMS-01**: A CMS editor's admin session lasts ~2h before OIDC re-auth (max + idle
  refresh = 7200s), with the access token still rotating at 5 min, and no infra env override
  pinning the old 600s values. (Tradeoff accepted per D9: revocation latency grows to ~2h.)

### Standalone Strapi Routes (Phase 2)
- [ ] **GPXCMS-02**: A curator can set a route's target map group via a free-text
  `Route.mapFolder` field (default "DEF CON 34 Maps").
- [ ] **GPXCMS-03**: A published Strapi `Route` with an attached GPX and no matching GLOBAL
  DynamoDB route renders as a first-class route on the public map, sourced from the CMS media GPX.
- [ ] **GPXCMS-04**: Standalone routes fold into the GLOBAL group named by `mapFolder`
  (synthesized if absent); a Strapi route matching an existing `gpxFileId` stays
  enrichment-only (DynamoDB wins — no double-render).
- [ ] **GPXCMS-05**: A standalone CMS route fits in view on toggle (client-side bounds fallback
  when no precomputed bounds exist).

### Strapi POIs (Phase 3)
- [ ] **GPXCMS-06**: A published `point-of-interest` related to a route renders as an icon at
  its coordinates on the map.
- [ ] **GPXCMS-07**: A POI icon uses its `markerImage` when present, else a `poiType`-based
  default icon/color.
- [ ] **GPXCMS-08**: Clicking a POI opens a popup with `name` + `description` + `photo`, styled
  like the route popup (colored left tab in the route color).
- [ ] **GPXCMS-09**: A route's POIs appear and disappear together with the route (toggle with
  the per-route layer).

## Success Criteria

**Phase 1**
1. A CMS editor stays logged in for ~2h of activity without being bounced to OIDC.
2. `config/admin.ts` defaults are 7200s for max + idle refresh; the deployed env is confirmed
   not to override them.

**Phase 2**
1. Creating a published Strapi Route with a GPX attached (no run.gpx upload) makes it appear on
   `gpx.defcon.run` under its `mapFolder` group within a manifest cache cycle.
2. A Strapi route whose `gpxFileId` matches an existing GLOBAL route does not double-render.
3. Toggling a CMS-authored route on fits it in view.
4. Studio frontend still builds clean (`./build-frontend.sh`).

**Phase 3**
1. A POI attached to a rendered route shows as an icon and, on click, a popup with its photo.
2. POIs use their `markerImage` when set, otherwise a `poiType` default.
3. Turning a route off hides its POIs; turning it on shows them.

## Already landed (related, on main)

- **Public route waypoint/POI pin color** (PR #383) — `getSvgForSymbol` no longer hardcodes
  Mapbox blue; public POI pins take the route color. Phase 3's `poiType` fallback builds on
  this icon path.
- **Hover-tooltip color tab** (PR #375-era work) — the route-color left border, mirrored later
  onto POI popups in Phase 3.
