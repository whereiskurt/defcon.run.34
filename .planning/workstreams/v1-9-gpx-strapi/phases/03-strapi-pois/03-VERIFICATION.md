---
phase: 3
phase_slug: strapi-pois
workstream: v1-9-gpx-strapi
status: passed
verified: 2026-07-05
method: static-inspection + build
---

# Phase 3 — Strapi POIs on the map — Verification

**Goal:** A published `point-of-interest` related to a route renders as an icon at its
coordinates (icon = `markerImage` when present, else a `poiType`-based default), with a click
popup (`name` + `description` + `photo`, colored left tab in the route color); POIs ride the
existing per-route POI layer so they toggle with the route. Verify marker-image cross-origin.

**Requirements:** GPXCMS-06, GPXCMS-07, GPXCMS-08, GPXCMS-09.

## Static / build checks (evidence)

| Design-contract item (req) | Result | Evidence |
|---|---|---|
| `strapi.ts` populates `pointsOfInterest` (coordinates→lat/lon, poiType, markerImage.url, photo.url, name, description, sortOrder) and fills `PoiMeta[]` (GPXCMS-06) | ✅ | `strapi.ts:202-` nested populate; `PoiMeta` (`:47-49`); sortOrder-sorted; coordinate-less POIs skipped; `description` plain text (no blocksToHtml); tsc exit 0 |
| Manifest nests `pois` on `PublicMap` for standalone AND Dynamo-enriched routes (GPXCMS-06, §3) | ✅ | `route.ts:81` `poisByGpxKey`, `:116` `poisByGpxKey.get(file.fileId) ?? get(file.fileName)` (enriched), `:190` `pois: r.pois...` (standalone); attached only when non-empty |
| Icon: `markerImage` via `map.addImage` else `poiType`→icon/color default (GPXCMS-07, D7) | ✅ | `public-overlays.ts:283` `POI_TYPE_ICONS` — **all 12** poiType enum values mapped (incl. `vendor`); `poiDefaultIcon` (`:305`) via `getSvgForSymbol`; `loadUrlImage` (`:516`) for markerImage |
| Risk 3 — cross-origin marker image with SVG fallback | ✅ | `:511-516` `crossOrigin='anonymous'` set before `src`; `onFail` → poiType SVG fallback under the same icon id (never blank) |
| Popup: name+description+photo, colored left tab in route color, all escaped (GPXCMS-08, D8) | ✅ | `poiPopupHtml` (`:331-339`) — escaped `name`/`desc`/`photoUrl`; photo `<img>`; left tab in route color; `escapeHtml` consistent with existing call sites |
| Strapi POIs distinguished from GPX waypoints via feature property (D8) | ✅ | `poiKind` feature property routes click → photo popup vs waypoint popup |
| POIs ride the existing per-route POI layer, toggle with route (GPXCMS-09, D5) | ✅ | `addRoutePois` merges `m.pois` into `poiLayerId(m.fileId)`; visibility via existing `setLayerPairVisible` — no new toggle machinery |
| Multi-route POI harmless-duplicate (no dedupe) | ✅ | per design §Edge cases; POIs attached per route |
| gpx-studio frontend builds clean | ✅ | `./build-frontend.sh` → exit 0, Vite `✓ built`, adapter-static wrote `build` → copied to `webapp/public/studio` |

## Verdict

**PASSED (code-complete).** All four requirements implemented faithfully to the design contract;
all 12 poiType values mapped; studio builds clean; typecheck clean; no build output committed.

## Open items (require running stack / deploy — cannot verify statically)

1. **Functional UAT:** a published POI related to a rendered route shows as an icon and, on click,
   a popup with its photo; markerImage used when set else poiType default; toggling the route
   hides/shows its POIs — needs a running Strapi + manifest + browser check.
2. **Risk 3 in prod:** the marker-image cross-origin load depends on the Phase 2 CMS-media CORS
   change being **deployed** (see Phase 2 open item). Until deployed, markerImage may taint and
   fall back to the poiType SVG icon — which is the intended, graceful degradation.

## Commits
- `1bac48a1` populate POIs in strapi.ts · `6f7ec6e6` nest POIs onto PublicMap · `92fbe35f` 03-01 summary
- `ffa10989` POI icon resolution (poiType map + cross-origin loader) · `45566826` render POIs into per-route layer · `45a6187d` 03-02 summary
