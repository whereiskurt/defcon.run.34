# GPX Public-Overlay CMS Route Enrichment (v1.8 Phase 2)

**Date:** 2026-07-03
**Status:** Approved design — ready for implementation plan
**Workstream:** `.planning/workstreams/v1-8-gpx-decoration/` (Phase 2)
**Depends on:** v1.8 overlay spike (`bb4014d5`) + live-verification fixes (`5b9704ce`), on branch `gsd/gpx-overlay-decoration`.

## Problem

The DEF CON 34 public overlays render today from the DynamoDB/S3 manifest
(`/api/gpx/public/maps`) with per-route colors from a code palette
(`dc34-palette.ts`). There is no way for an editor to brand a specific route —
give it a custom line color, a cover photo, a write-up, or points of interest.
The CMS `Route` content-type already models all of that; it is simply not
joined to the overlays.

## Goal

Let an editor enrich an existing public-overlay route via a CMS `Route` entry,
keyed to the overlay by `gpxFileId`. When a CMS entry exists, its styling drives
the line paint and its content drives the click popup. When it does not (or CMS
is unreachable), the overlay behaves exactly as it does today.

**Non-goal:** CMS does not become the source of which routes exist. DynamoDB
remains authoritative; CMS is a pure decoration side-car.

## Architecture (approach A: styling in the manifest, content lazy)

Two data needs with different timing:

- **Styling** (`mapColor`, `mapWeight`, `mapOpacity`) is needed when a route
  *renders*, so it is merged into the manifest.
- **Rich content** (cover photo, write-up, POIs) is needed only when a route is
  *clicked*, so it is fetched lazily by a separate endpoint.

```
CMS Route (token-only)            run.gpx (server)                 studio (browser)
  gpxFileId ─────────────┐
  mapColor/Weight/Opacity │  GET /api/gpx/public/maps ──── manifest + styling ──→ line paint
  coverImage/description/ │      (merges CMS styling by gpxFileId, cached)
  pointsOfInterest ───────┴  GET /api/gpx/public/route-details?fileId= ─ on click → popupHtml()
```

### 1. CMS (`apps/run.cms`)

- **Schema:** add `gpxFileId` (`string`, optional, indexed if practical) to
  `api/route/content-types/route/schema.json`. The join key = the overlay
  manifest route's `fileId`.
- No other schema change: `mapColor` (default `#FF5733`), `mapWeight` (3),
  `mapOpacity` (0.8), `coverImage`, `description` (blocks), `shortDescription`,
  and `pointsOfInterest` (relation) already exist.
- Public API stays token-only (`revokePublicPermissions()` on bootstrap,
  `src/index.ts`). run.gpx authenticates with a read-only API token.

### 2. run.gpx read-side (`apps/run.gpx/webapp`)

Mirror the established `run.human/src/lib/strapi.ts` client pattern.

- **`src/lib/strapi.ts`** (new): a minimal token-authenticated Strapi client
  reading `CMS_URL` + `STRAPI_API_TOKEN` from env.
  - `fetchRouteStyles(): Map<gpxFileId, {mapColor,mapWeight,mapOpacity}>` —
    one query of published `routes` with a `gpxFileId`, for the manifest merge.
  - `fetchRouteDetails(fileId): {coverImageUrl?, descriptionHtml?, pois[]} | null`
    — one route by `gpxFileId`, populated, for the lazy endpoint.
- **`/api/gpx/public/maps/route.ts`** (edit): after building the DynamoDB groups,
  call `fetchRouteStyles()` once and merge `mapColor/mapWeight/mapOpacity` onto
  each map entry whose `fileId` matches. Extend the manifest `PublicMap` type.
- **`/api/gpx/public/route-details/route.ts`** (new): `GET ?fileId=` →
  `fetchRouteDetails(fileId)`. Short cache. 404/empty when no CMS entry.

### 3. Studio (`apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts`)

- **Paint:** color already reads `m.mapColor`. Add `m.mapWeight` → core
  `line-width` (glow scales proportionally) and `m.mapOpacity` → core
  `line-opacity`, each falling back to the current constants.
- **Popup:** make `popupHtml` async. On click, `fetch(route-details?fileId=)`;
  if it returns content, render cover photo + write-up + POI list above the
  existing metadata; otherwise render today's metadata unchanged. Show the
  existing content immediately, then upgrade when details resolve (no blocking
  spinner on the map thread).

## Data flow

1. Studio loads → `GET /api/gpx/public/maps` → run.gpx queries DynamoDB (routes)
   **and** CMS (`fetchRouteStyles`), merges styling by `gpxFileId`, returns.
2. Studio renders each route; paint uses CMS styling when present, else palette +
   constants.
3. User clicks a route → studio `GET /api/gpx/public/route-details?fileId=` →
   run.gpx queries CMS by `gpxFileId` → popup upgrades with photo/write-up/POIs.

## Error handling / degradation

Enrichment is strictly additive and best-effort:

- No `STRAPI_API_TOKEN` / `CMS_URL`, CMS unreachable, or query error → manifest
  merge is skipped (log + continue); routes render with the palette.
- No CMS entry for a `fileId` → no styling merged, `route-details` returns empty
  → popup shows today's metadata.
- `route-details` failure in the browser → popup keeps the immediate metadata.

Prod behavior is unchanged until CMS entries + the token exist.

## Verification (local)

1. Start local run.cms: `cd apps/run.cms/app && npm run develop` (:1337, SQLite);
   create an admin, then a read-only API token.
2. Create a `Route` entry with `gpxFileId` = a seeded overlay route's `fileId`,
   a distinct `mapColor`, a `coverImage`, and a short `description`.
3. Set run.gpx `CMS_URL=http://localhost:1337` + `STRAPI_API_TOKEN=…`; restart
   :3003.
4. Re-drive the studio (per `reference_gpx_overlay_local_verify`): confirm the
   route renders in the CMS `mapColor` (overriding the palette) at the CMS
   weight/opacity, and its popup shows the cover photo + write-up.
5. Delete the token / stop CMS → confirm graceful fallback to palette + metadata.

## Out of scope

- CMS becoming the authoritative route list / driving which routes exist.
- Admin UX for discovering a route's `fileId` (documented manual copy for now).
- User Check-ins (v1.8 Phase 3) — separate.
