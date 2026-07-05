# Strapi-Authorable Routes & POIs — Design

- **Date:** 2026-07-05
- **App:** `apps/run.gpx` (public map overlays) + `apps/run.cms` (Strapi)
- **Status:** Approved design — ready for GSD phase planning
- **Author:** Kurt + Claude (brainstormed)

## Summary

Let curators (Jesse & co.) author DEF CON run content **entirely in Strapi** and have it
appear on the public map at `gpx.defcon.run`:

1. **Standalone routes** — a Strapi `Route` that carries its own GPX asset renders as a
   first-class route on the map (no run.gpx upload / DynamoDB round-trip).
2. **Points of interest** — a Strapi `point-of-interest` (with coordinates, marker image, and
   a photo) renders as an icon on the map with a popup styled like today's route popup.
3. **Whole-unit behavior** — a fully CMS-authored route (GPX + attached POIs + photos) appears
   and toggles as a single unit: turn the route on and its line **and** its POIs appear together.

Plus a small operational fix: **bump the CMS admin session** from ~10 min to ~2 h.

This flips Strapi from a *right-join enricher* (it decorates DynamoDB routes today) into *also a
left source* (it can originate routes and POIs), while leaving the existing PUBLIC mechanism —
admin-published routes and user-submitted "Rabbit Routes" (DynamoDB + S3) — untouched.

## Current architecture (grounding)

Routes on the public map come **entirely from DynamoDB**, not Strapi:

- `GpxFolder` / `GpxFile` rows under `userId="GLOBAL"`, `isGlobal=true`. Two folders:
  **"DEF CON 34 Maps"** (admins publish directly) and **"Rabbit Routes"** (a user flags
  `shareRequested` → an admin approves → the S3 object is copied into the GLOBAL folder). Both
  are just GLOBAL folders by name; nothing structural distinguishes them.
- GPX bytes live in S3 (`S3_UPLOADS_BUCKET` → `uploads/GLOBAL/gpx/{fileId}.gpx`). The manifest
  hands out a short-lived **presigned** download URL per file.
- **Strapi is enrichment-only today.** `GET /api/gpx/public/maps` calls `fetchRouteMeta()`
  (`apps/run.gpx/webapp/src/lib/strapi.ts`), which hits Strapi `/api/routes`, and *right-joins*
  onto the DynamoDB list by `gpxFileId` (matched against a DynamoDB `fileId` **or** filename). It
  supplies `title`, write-up, `mapColor`, cover image, Strava link, etc. — but never decides
  *which* routes appear and never supplies geometry.

Key files:

| Concern | File |
|---|---|
| Public manifest | `apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts` |
| Strapi client | `apps/run.gpx/webapp/src/lib/strapi.ts` |
| S3 helper | `apps/run.gpx/webapp/src/lib/s3-client.ts` |
| Frontend overlay renderer | `apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts` |
| Waypoint icon SVG | `apps/run.gpx/gpx-studio/website/src/lib/components/map/gpx-layer/gpx-layer.ts` (`getSvgForSymbol`) |
| CMS Route content-type | `apps/run.cms/app/src/api/route/content-types/route/schema.json` |
| CMS POI content-type | `apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json` |
| CMS admin session config | `apps/run.cms/app/config/admin.ts` |
| CMS media/upload config | `apps/run.cms/app/config/plugins.ts` |

### What the CMS already gives us (no new content-types needed)

The Strapi `Route` already has a **`gpxFiles`** media field (multiple, files-only) — a curator
can attach a GPX today; the manifest simply ignores it. The `point-of-interest` content-type is
already rich:

```
point-of-interest:
  name (required), slug, description (text)
  coordinates (shared.coordinates component, required)   ← lat/lon
  poiType (enum: water-station, rest-stop, start-finish, aid-station,
           photo-opportunity, scenic-viewpoint, lockpick-village,
           badge-station, swag-drop, rf-check-in, vendor, social-gathering-spot)
  markerImage (single image)   ← the map icon
  photo (single image)         ← the popup picture
  sortOrder (int)
  routes (manyToMany → api::route.route)
```

Strapi media uploads land in a **separate** bucket (`S3_MEDIA_BUCKET`, rootPath `{region}/cms`),
served publicly via CloudFront `cms.defcon.run`.

## Goals

- A published Strapi `Route` with an attached GPX renders on the map as a route.
- A published Strapi `point-of-interest` renders as an icon + popup, toggling with its route(s).
- A fully CMS-authored route (GPX + POIs + photos) appears and toggles as one unit.
- Curators keep a usable (~2 h) CMS session instead of re-authenticating every ~10 min.
- The existing PUBLIC mechanism (admin publish + Rabbit Routes) is unchanged.

## Non-goals / parked

- **Trimming the `Route` data structure.** Explicitly deferred — this feature leans on *more*
  Route fields (`gpxFiles`, `mapFolder`, `sortOrder`, descriptions), so a field cull is a
  separate later cleanup.
- Editing/authoring routes *from* the studio into Strapi (Strapi admin remains the authoring UI).
- Changing how DynamoDB-backed routes are published or how Rabbit Routes are approved.

## Design decisions (resolved during brainstorming)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | How to detect a *standalone* Strapi route | **Infer**: has `gpxFiles` asset **and** no matching GLOBAL DynamoDB route | Zero new fields; matches the "pass the GPX when present" model. A Strapi route matching an existing `gpxFileId` stays enrichment-only. |
| D2 | Collision (Strapi route matches a DynamoDB route by `gpxFileId`) | **DynamoDB wins** — enrichment only, never double-render | Preserves today's behavior; the CMS record acts as a stub. |
| D3 | Which map group a standalone route joins | New **free-text `Route.mapFolder`** field, default `"DEF CON 34 Maps"` | Matches a GLOBAL folder by name (synthesize if absent); future groups need no schema change. Free-text chosen over an enum for flexibility. |
| D4 | `mapFolder` scope | **Standalone routes only** — never relocates a Dynamo-backed route | Avoids a surprising side-effect on existing routes. |
| D5 | POI visibility | **Toggle with the route** (reuse the per-route POI sub-layer) | A CMS-authored route + its POIs behave as one unit; "attached to the route" model. |
| D6 | POI delivery to the frontend | **Nested in the manifest** per route | Reuses the existing per-route POI layer machinery; one fetch. |
| D7 | POI icon | `markerImage` when present, else a **`poiType`→icon/color** default | Curators get control; sensible default when they don't set one. |
| D8 | POI popup | `name` + `description` + `photo`, styled like the route popup (colored left tab in the route color) | Visual consistency with existing popups. |
| D9 | CMS session length | `maxRefreshTokenLifespan` + `idleRefreshTokenLifespan` → **7200 s (2 h)**; keep the 5-min access token | Convenience for a small trusted editor pool; access tokens still rotate. |

### D9 tradeoff (explicit)

The short session is a **security control**: each full OIDC re-auth re-validates the `services`
claim, so revoked CMS access takes effect within ~10 min today. At 2 h, **a revoked editor keeps
CMS access for up to ~2 h.** Accepted for the small trusted editor pool. (Optional refinement:
idle 2 h but max 8 h so an active edit isn't cut off mid-write-up while an abandoned session
still expires — not adopted unless requested.)

## Detailed design

### 1. CMS schema — `Route.mapFolder`

Add to `apps/run.cms/app/src/api/route/content-types/route/schema.json`:

```json
"mapFolder": {
  "type": "string",
  "default": "DEF CON 34 Maps"
}
```

No change to the `point-of-interest` content-type.

### 2. Strapi client — `strapi.ts` (`fetchRouteMeta`)

- **Widen the query filter** so CMS-native routes (which may have no `gpxFileId`) are included:
  fetch published routes where `gpxFileId` is not null **OR** `gpxFiles` is not null.
- **Populate** `gpxFiles` (url, name), `mapFolder`, and `pointsOfInterest` with their
  `coordinates`, `poiType`, `markerImage` (url), `photo` (url + a sized format), `name`,
  `description`, `sortOrder`.
- **Return**, per route: the existing `RouteMeta` (enrichment) **plus**
  `{ documentId, gpxUrl?, gpxName?, mapFolder, pois: PoiMeta[] }`.
- Keep the existing best-effort semantics (timeout, empty-map fallback) so the manifest never
  breaks if Strapi is unavailable.

New shapes (illustrative):

```ts
interface PoiMeta {
  name: string;
  description?: string;
  lat: number;
  lon: number;
  poiType?: string;
  markerImageUrl?: string;   // CMS media (cms.defcon.run)
  photoUrl?: string;         // CMS media
  sortOrder?: number;
}
// fetchRouteMeta() returns Map<joinKey, RouteMeta & {
//   documentId, gpxUrl?, gpxName?, mapFolder, pois: PoiMeta[]
// }>
```

### 3. Manifest — `public/maps/route.ts`

1. Build the DynamoDB groups exactly as today.
2. **Standalone routes:** for each Strapi route with a `gpxFiles` asset whose `gpxFileId` matches
   no GLOBAL DynamoDB `fileId`/filename, emit a `PublicMap`:
   - `fileId: "cms-{documentId}"` (namespaced; cannot collide with DynamoDB UUIDs)
   - `downloadUrl = gpxUrl` (public CMS media URL — no presign needed)
   - `fileName = gpxName` (so `prettyRouteName` works), CMS metadata folded in (`title`,
     `descriptionHtml`, `distanceKm`, `elevationM`, `mapColor`, cover image, `stravaUrl`)
   - Merge into the group named by `mapFolder` — reuse that GLOBAL folder's `folderId` if it
     exists, else synthesize a group (`folderId: "cms-folder-{slug(mapFolder)}"`). Order by
     `Route.sortOrder`.
3. **POIs:** attach each Strapi route's `pois` to its `PublicMap` (both standalone routes **and**
   Dynamo-enriched routes get their Strapi POIs). Emit as a `pois` array on `PublicMap`.
4. Apply the existing empty-group drop **after** merging standalone routes.
5. Preserve the `Cache-Control: s-maxage=300` header (well under any presign TTL).

`PublicMap` gains an optional field:

```ts
pois?: {
  name: string; description?: string; lat: number; lon: number;
  poiType?: string; markerImageUrl?: string; photoUrl?: string;
}[];
```

### 4. Frontend — `public-overlays.ts` (+ `gpx-layer.ts`)

- **POI rendering.** In `addRoutePois` (or a sibling), render `m.pois` into the **existing
  per-route POI layer** so they show/hide with the route via `setLayerPairVisible`:
  - Icon: load `markerImageUrl` as a map image when present; else render a `poiType`→icon/color
    SVG (reuse `getSvgForSymbol` / the DC34 pin catalog with a `poiType` map). Image id keyed so
    each (icon, color) pair registers once.
  - Click → popup: `name` + `description` + `photo`, using a `poiPopupHtml`-style builder with a
    colored left tab in the route color (consistent with existing popups). Distinguish Strapi
    POIs from GPX waypoints via a feature property so the right popup builder runs.
- **Bounds fallback.** Standalone CMS routes have no precomputed `bounds`. Since the frontend
  already parses the GPX, derive bounds client-side from the parsed GeoJSON when `m.bounds` is
  absent, so fit-on-toggle still works. (~5 lines; skippable.)
- No other rendering changes — the line layer is source-agnostic.

### 5. CMS session — `config/admin.ts`

Bump the defaults (all `env.int`-overridable):

```
ADMIN_MAX_REFRESH_LIFESPAN:  600  → 7200   (2 h)
ADMIN_IDLE_REFRESH_LIFESPAN: 600  → 7200   (2 h)
ADMIN_ACCESS_TOKEN_LIFESPAN: 300  (unchanged)
```

**Verify no infra override pins the old values** — check the Terragrunt/ECS task definition for
run.cms (`infra/terraform/...`) for `ADMIN_MAX_REFRESH_LIFESPAN` / `ADMIN_IDLE_REFRESH_LIFESPAN`.
If pinned to `600`, updating the code default alone will not take effect.

## Data flow (target)

```
Curator in Strapi:
  Route: name, mapColor, mapFolder, gpxFiles(+.gpx), + related POIs (coords, markerImage, photo)

GET /api/gpx/public/maps  (unauthenticated)
  1. fetchRouteMeta() ─► Strapi /api/routes
        filter: gpxFileId notNull OR gpxFiles notNull
        populate: gpxFiles, mapFolder, pointsOfInterest{coordinates,markerImage,photo,...}
  2. DynamoDB GLOBAL folders/files  → groups (unchanged)
  3. standalone CMS routes (gpxFiles, no Dynamo match)
        → PublicMap{ fileId:"cms-{documentId}", downloadUrl:gpxUrl, ... }
        → merged into group == mapFolder  (synthesize if absent)
  4. attach route.pois → PublicMap.pois   (standalone AND enriched routes)
  └─► { groups:[{ folderId, folderName, maps:[PublicMap{ ..., pois:[...] }] }] }

gpx-studio frontend:
  route line   (existing, source-agnostic)
  route POIs   (existing per-route POI layer; now also renders m.pois with images + rich popup)
  toggle route → line + POIs appear/disappear together
```

## Edge cases & rules

- **Collision:** Strapi route with `gpxFiles` **and** a `gpxFileId` matching a GLOBAL route →
  DynamoDB renders the line; the CMS record only enriches + contributes POIs. No double-render.
- **Multi-route POI:** a POI related to N routes renders under each route's POI layer. Harmless
  duplicate only when more than one of those routes is toggled on simultaneously.
- **Missing GPX asset:** a Strapi route with no `gpxFiles` and no Dynamo match renders nothing
  (it's an orphan stub) — acceptable; it simply won't appear.
- **`mapFolder` typo:** names a non-existent folder → a new synthetic group is created with that
  name. (Free-text tradeoff; acceptable per D3.)
- **Strapi unavailable:** manifest degrades to DynamoDB-only (existing best-effort behavior).

## Risks / build-time verifications

1. **Cross-origin GPX fetch.** The frontend already fetches presigned GPX cross-origin from the
   *uploads* bucket, so the pattern exists — but the CMS media distribution (`cms.defcon.run`)
   must allow the studio origin to `fetch()` the `.gpx`. **Verify/add CORS on the CMS
   CloudFront.** Fallback: a small same-origin proxy route in run.gpx that streams the CMS GPX.
2. **Strapi accepting `.gpx` uploads.** The `gpxFiles` field is `allowedTypes:["files"]`, but
   Strapi's uploader may reject the `.gpx` extension/mime. May need an upload-config whitelist.
3. **Marker image as a map icon.** `map.addImage` from a cross-origin URL can taint the canvas
   without CORS. If CMS images aren't CORS-enabled, fall back to `poiType` SVG icons for the
   marker (the `photo` in the popup uses a plain `<img>` and is unaffected).
4. **Infra env pin.** See §5 — the session bump is inert if Terragrunt pins the old lifespans.

## Suggested GSD phase breakdown

Independent-ish slices; POIs depend on the manifest changes, standalone routes and the session
bump are independent.

- **Phase A — CMS session bump.** `config/admin.ts` defaults → 7200 s; verify/patch infra env.
  Smallest, independent, shippable alone.
- **Phase B — Standalone Strapi routes.** `Route.mapFolder` schema field; `strapi.ts` filter +
  populate + return shape; manifest standalone-route emission + `mapFolder` grouping; client-side
  bounds fallback. Verify CORS/`.gpx` upload (Risk 1 & 2).
- **Phase C — Strapi POIs.** `strapi.ts` populate `pointsOfInterest`; manifest nests `pois`;
  frontend POI icon (markerImage / poiType fallback) + rich popup, toggling with the route.
  Verify marker-image CORS (Risk 3).

Phases B and C share the `strapi.ts` / manifest / `public-overlays.ts` files, so if run as
parallel waves they should coordinate on those files (or run B before C).

## Already landed (related, on this branch)

- **Public route waypoint/POI pin color** — `getSvgForSymbol` no longer hardcodes Mapbox blue;
  public POI pins take the route color (commit on `gsd/gpx-strapi-routes-pois`). This is the
  icon path Phase C's `poiType` fallback builds on.
