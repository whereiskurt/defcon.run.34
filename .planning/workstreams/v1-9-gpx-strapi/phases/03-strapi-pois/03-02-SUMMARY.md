---
phase: 03-strapi-pois
plan: 02
subsystem: run.gpx
tags: [strapi, poi, gpx-studio, map, markerimage, popup, cross-origin, xss]
requires:
  - "PublicMap.pois nested onto the public maps manifest (plan 03-01)"
  - "getSvgForSymbol(symbol, layerColor?, pinColor?) route-color pin + symbols catalog (already landed)"
  - "Per-route POI layer machinery: addRoutePois / poiLayerId / setLayerPairVisible / loadSvgImage / poiPopupHtml (v1.7/v1.8)"
provides:
  - "Studio renders each m.pois entry as an icon in the per-route POI layer (toggles with the route)"
  - "POI icon resolution: markerImageUrl via cross-origin loadUrlImage else a poiType→icon/color default"
  - "poiKind-routed photo popup (name + escaped description + escaped photo) distinct from GPX waypoints"
affects:
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts
tech-stack:
  added: []
  patterns:
    - "Cross-origin raster map icon via new Image(); crossOrigin='anonymous' set BEFORE src, with an onerror/taint SVG fallback under the SAME image id (Risk 3 — icon never blank)"
    - "poiType→{symbol,color} const map feeding getSvgForSymbol for a route-color pin default (drop corner badge via undefined layerColor)"
    - "Heterogeneous features (GPX waypoints + Strapi POIs) merged into one source, disambiguated by a poiKind feature property for popup routing"
    - "Stable djb2 image id per marker url so each distinct marker image registers via map.addImage exactly once"
key-files:
  created: []
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts
decisions:
  - "Used the plan's 'simpler contract' for markerImage: feature icon = markerId, poiType default registered under markerId on onFail — so the same icon id always resolves to a drawable image (marker or default). Avoids a live setData icon-swap."
  - "poiDefaultIcon reuses getSvgForSymbol(symbol, undefined, color) — the identical route-color pin path GPX waypoints use — so a poiType default and a waypoint pin look consistent (D7)."
  - "All 12 poiType enum values mapped to a real symbols catalog key + a DC34 palette color; an unknown/absent poiType falls back to a plain route-color pin."
  - "poiPopupHtml gained an optional 4th photoUrl param; name/desc/photoUrl all escaped via escapeHtml — POI text is plain CMS text, no raw-HTML passthrough (T-03-05)."
  - "No toggle machinery added — POIs live in poiLayerId(m.fileId), which setLayerPairVisible already flips with the route (D5/GPXCMS-09)."
metrics:
  duration: "~12m"
  completed: "2026-07-05"
status: complete
requirements: [GPXCMS-06, GPXCMS-07, GPXCMS-08, GPXCMS-09]
---

# Phase 3 Plan 02: Render Strapi POIs in the Studio Summary

Rendered the manifest POIs in the gpx-studio map: each `m.pois` entry (nested by plan 03-01) now draws as an icon in the SAME per-route POI layer as the GPX waypoints, so it shows/hides with the route via the existing `setLayerPairVisible` (D5/GPXCMS-09) — no new toggle path. A POI uses its CMS `markerImage` (loaded cross-origin, with a poiType SVG fallback on failure/taint, Risk 3) when present, else a `poiType`→icon/color default built on the already-landed `getSvgForSymbol` route-color pin (D7). Clicking a Strapi POI opens a photo popup (name + escaped description + escaped `<img>` photo, colored left tab in the route color), distinct from the GPX-waypoint popup via a `poiKind` feature property (D8). One file edited — `public-overlays.ts` — and the studio builds clean via `./build-frontend.sh`.

## What Was Built

### Task 1 — POI icon resolution primitives (committed `ffa10989`)
- `apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts`.
- Added `pois?` to the studio `PublicMap` type mirroring plan 03-01's shape (`{ name; description?; lat; lon; poiType?; markerImageUrl?; photoUrl? }[]`).
- `POI_TYPE_ICONS: Record<string, { symbol?: string; color: string }>` covering **all 12** `poiType` enum values (`water-station`, `rest-stop`, `start-finish`, `aid-station`, `photo-opportunity`, `scenic-viewpoint`, `lockpick-village`, `badge-station`, `swag-drop`, `rf-check-in`, `vendor`, `social-gathering-spot`). Every `symbol` is a verified `symbols.ts` catalog key (`water_source`, `shelter`, `information`, `pharmacy`, `binoculars`, `scenic_area`, `building`, `shopping_center`, `telephone`, `restaurant`, `campground`), and every `color` is a real `DC34` palette value.
- `poiDefaultIcon(poiType, routeColor)` → `{ iconId, svg }` built via `getSvgForSymbol(symbol, undefined, color)` (the SAME route-color pin the GPX waypoints use; corner badge dropped by passing `undefined` for `layerColor`). Unknown/absent poiType → `{ symbol: undefined, color: routeColor }` (plain route-color pin). `gpx-layer.ts` was NOT modified.
- `loadUrlImage(id, url, onFail)` — private method mirroring `loadSvgImage`: `new Image()`, `img.crossOrigin = 'anonymous'` set **before** `img.src = url`, `map.addImage` on load (guarded by `hasImage`), and `onFail()` on `img.onerror` OR when `addImage` throws on a slipped-through taint (Risk 3, not silent).
- `markerImageId(url)` — stable djb2 hash → `dc34-poi-img-<base36>` so each distinct marker image registers exactly once (D7).
- `poiPopupHtml` gained an optional 4th `photoUrl` param rendering a plain escaped `<img loading="lazy">` below the text; `name`/`desc`/`photoUrl` all `escapeHtml`-ed.
- Task 1 grep gate: **PASS**.

### Task 2 — render `m.pois` into the per-route POI layer with a rich popup (committed `45566826`)
- Same file — reworked `addRoutePois(m, waypoints)`:
  - Early return now proceeds when EITHER GPX waypoints OR `m.pois` exist (`if (!waypoints.length && !(m.pois?.length)) return;`).
  - GPX waypoints keep today's route-color pin, now tagged `poiKind: 'waypoint'`.
  - Strapi POIs (`m.pois`): one `Point` feature per POI at `[lon, lat]` with `poiKind: 'strapi'`, `name`, `desc` (= `description ?? ''`), `photoUrl` (= `photoUrl ?? ''`), and a resolved `icon`. Icon: when `markerImageUrl` is set, `icon = markerId` and `loadUrlImage(markerId, url, onFail)` where `onFail` registers the poiType default **under the same `markerId`** — so the feature icon always resolves to a drawable image (marker on success, default on failure/taint); otherwise `poiDefaultIcon(poiType, m.color)` registered via `loadSvgImage`.
  - Click handler routes by `p.poiKind`: `'strapi'` → photo-extended `poiPopupHtml(name, desc, m.color, photoUrl || undefined)`; else the existing waypoint popup — unchanged.
  - No toggle code added; POIs ride `poiLayerId(m.fileId)` → `setLayerPairVisible` (glow+core+poi) with the route (D5/GPXCMS-09). Multi-route POIs duplicate harmlessly per the design (no dedupe).
- Task 2 grep gate: **PASS**. `./build-frontend.sh`: **exit 0, clean** (Vite `✓ built`, adapter-static wrote `build`, output copied to `webapp/public/studio`).

## Verification

- Task 1 grep gate (`POI_TYPE_ICONS`, `loadUrlImage`, `crossOrigin`, `social-gathering-spot`, `water-station`, `pois?:`): **PASS**.
- Task 2 grep gate (`poiKind: 'strapi'`, `poiKind: 'waypoint'`, `m.pois`, `photoUrl`, `loadUrlImage`): **PASS**.
- `./apps/run.gpx/build-frontend.sh`: **exit 0, clean build** (run twice; second run confirmed exit 0). Regenerated studio artifacts are gitignored (Phase 2 finding) — post-build `git status --short` showed ONLY the `public-overlays.ts` source edit; no build output committed.

## Deviations from Plan

None — plan executed exactly as written. Task 2 used the plan's explicitly-offered "simpler contract" for the markerImage path (feature `icon = markerId`; poiType default registered under `markerId` as the `onFail` fallback) rather than a live `setData` icon-swap, which the plan permits when the live-swap would exceed ~10 lines. No auto-fixes (Rules 1–3) were needed; no architectural decisions (Rule 4) arose.

## Known Stubs

None. All 12 `poiType` enum values map to a concrete icon; POIs with no `markerImage` still get a poiType default; POIs with no `poiType` get a plain route-color pin. No placeholder/empty-data paths introduced.

## Threat Surface

No new surface beyond the plan's `<threat_model>`:
- **T-03-04 (Tampering / canvas taint, mitigate):** `loadUrlImage` sets `crossOrigin='anonymous'` before `src` and relies on the CMS-media CORS from Phase 2 (02-03); on any load failure OR an `addImage` taint throw it falls back to the poiType SVG default under the same id — a POI is never left blank. The popup `photo` uses a plain `<img>` (no canvas) and is unaffected.
- **T-03-05 (XSS, mitigate):** POI `name`/`description`/`photoUrl` all pass through `escapeHtml` before insertion; `description` is plain CMS text, never treated as HTML. No `innerHTML` raw passthrough introduced.
- **T-03-06 (Spoofing marker URL, accept):** `markerImageUrl` originates from a trusted-editor CMS media field on `cms.defcon.run`, loaded as an image only; a hostile URL at worst fails to load and triggers the poiType fallback.

## Self-Check: PASSED
- `apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts` — FOUND (commits `ffa10989`, `45566826`)
- Commit `ffa10989` — FOUND
- Commit `45566826` — FOUND
