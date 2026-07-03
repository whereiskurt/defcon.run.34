# v1.8 — GPX Overlay Decoration & User Check-ins

**Branch:** `gsd/gpx-overlay-decoration` (off `origin/main`)
**Started:** 2026-07-03 · **Status:** visual spike built + builds clean; NOT visually verified, NOT deployed, NO PR yet.
**Scope note:** New v1.8 scope. NOT covered by the v1.7 auto-merge authorization — get Kurt's review before landing.

## What Kurt asked for

Decorate the public GPX overlay routes (the "DEF CON 34 Maps" / "Rabbit Routes" GLOBAL groups shipped in v1.7):

1. **Styled route lines** — wider, fuzzier (neon glow), varied colors from the DEF CON 34 palette + variations.
2. **Click-a-route → details popup** — ultimately enriched from `cms.defcon.run` (global run metadata).
3. **New "User Check-ins" overlay** — a new toggleable layer group plotting all users' check-ins as big-icon points.

## Kurt's decisions (2026-07-03)

- **Start with a visual spike** of #1 + #2 (done — see below).
- **User Check-ins ships behind the `isPrivate` filter** — public map shows only `isPrivate === false` check-ins, WITH display names. He explicitly OK'd showing names/coords publicly.
- **Add an explicit `gpxFileId` field to the CMS `Route` content type** as the GPX↔CMS join key (no such link exists today).

## Spike delivered (Phase 1 — styling + popup, studio-only, zero backend)

All in `apps/run.gpx/gpx-studio/website/`:
- `src/lib/dc34-palette.ts` (NEW) — studio-local DC34 palette. Primary teal `#00d4aa`, magenta `#e6007a`, cyan `#00e5ff`, + a varied route ramp cycled per route. (Studio is a separate Vite build → cannot import the Next.js apps' Tailwind theme, hence a local module.)
- `src/lib/components/map/public-overlays.ts` (REWRITE) — per route: a blurred **glow under-layer** (`line-blur:6`, `line-width:14`, opacity .35) beneath a crisp **core line** (`line-width:4`, opacity .95), both colored from the palette; CMS `mapColor` overrides the palette color when present (hook wired, not yet fed). Click a route → `mapboxgl.Popup` with details (name, distance, elevation, tracks, uploadedBy) built from the manifest; `popupHtml()` is the CMS-enrichment slot.
- `src/lib/components/map/layer-control/PublicOverlays.svelte` — color swatch next to each route in the legend.
- `src/app.css` — dark-theme popup styling (`.dc34-route-popup .mapboxgl-popup-content`).

**Verification:** `cd apps/run.gpx && ./build-frontend.sh` → exit 0, SSR + client bundles transformed clean, output copied to `webapp/public/studio`. NOT rendered/clicked on a live map yet.

## Carry-on instructions

### Immediate: verify the spike visually
- Run the studio locally: `cd apps/run.gpx/webapp && PORT=3003 npm run dev` (needs `.env` with a Mapbox token + a gpxstudio-scoped session). The manifest `/use1/api/gpx/public/maps` is live in prod with 15 DC33 routes, so pointing at prod data is easiest.
- Confirm: glow lines render, per-route colors vary, legend swatches match, clicking a route opens the dark popup with metadata.
- If good → `km-signed-commit` the branch (see `reference_signed_bot_commits` in memory — signed bot commits BEFORE opening the PR) and open a draft PR. Merge is REVIEW_REQUIRED (bot can't self-approve) → Kurt approves or adds bot to bypass.

### Phase 2 — CMS enrichment (the real popup content)
1. Add `gpxFileId` (string) to the CMS Route type: `apps/run.cms/app/src/api/route/content-types/route/schema.json`. Editors set it to bind a CMS Route to a public GPX `fileId`.
2. Expose route metadata publicly. CMS revokes all public perms on boot (`apps/run.cms/app/src/index.ts revokePublicPermissions()`), so pick one:
   - run.gpx gets its own read-only Strapi token (SSM, mirror run.human's `run-human-internal` token + `src/lib/strapi.ts` pattern) and adds `GET /api/gpx/public/route-details?fileId=…` that server-side fetches the CMS Route (by `gpxFileId`), returning a light JSON `{title, description(html), coverImage(url), distance, elevation, duration, mapColor/Weight/Opacity, pois:[{name,type,lat,lon,photo}], events:[…]}`. Keeps the studio same-origin.
3. In `public-overlays.ts`: on route click, fetch `/api/gpx/public/route-details?fileId=…` and render the richer popup (cover photo, write-up, POI list). Feed `mapColor/mapWeight/mapOpacity` into the line paint (override hook already present for color; add width/opacity).
4. Optional: drop the route's POIs as their own small branded icons (water-station/aid-station/badge-station etc.) using the studio's `getSvgForSymbol` + `addImage` (see `gpx-layer/gpx-layer.ts loadIcons()`).

### Phase 3 — "User Check-ins" overlay (behind isPrivate filter)
1. run.human: add public `GET /api/checkins/public` (NO auth) — calls `getRecentCheckIns()` (already exists in `apps/run.human/webapp/src/entities/checkin.ts`, backed by the `byGlobalRecent` GSI), filters `isPrivate === false`, batch-joins `RunUser.displayName`, projects `{lat, lon, displayName, timestamp, checkInType}`. Watch the privacy surface — this publishes user locations; `isPrivate` defaults true so it's opt-out.
2. run.gpx: proxy it at `GET /api/gpx/public/checkins` (mirrors the Strava "option 3" cross-service pattern) so the studio stays same-origin.
3. Studio: add a "User Check-ins" group to the public-overlays state + a symbol layer of big branded pins (reuse `getSvgForSymbol` + `addImage`, recolor to `#00d4aa`/`#e6007a`); cluster at scale; popup with displayName + time. Surface it in `PublicOverlays.svelte` alongside the route groups.

### Reference (verify before trusting — see memory `project_gpx_public_overlay.md`)
- Real DynamoDB table for run.gpx = `run-gpx-electro` (NOT the entity default `dc34-gpx`).
- App AWS account 427284555693 (profiles `dc34-application`/`dc34-terraform`); mgmt 481723467561.
- Deploy: buildpub (bump PAST existing ECR tags — immutable-tag drift) → deploy.yml `pr_number=latest`. Cluster `app-use1-dc34`, service `run-gpx-use1`.
