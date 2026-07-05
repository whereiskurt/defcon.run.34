---
phase: 03-strapi-pois
plan: 01
subsystem: run.gpx
tags: [strapi, poi, manifest, points-of-interest, cms-native, enriched-routes]
requires:
  - "fetchRouteMeta() two-part return { byGpxKey, cmsRoutes } (plan 02-02)"
  - "PoiMeta + CmsRouteData.pois seam + PublicMap.pois? seam (plan 02-02)"
provides:
  - "fetchRouteMeta() populates pointsOfInterest and fills CmsRouteData.pois with a sorted PoiMeta[]"
  - "poisByGpxKey lookup in the manifest attaching POIs to standalone AND Dynamo-enriched routes"
  - "PublicMap.pois now SET in /api/gpx/public/maps (consumed by studio in plan 03-02)"
affects:
  - apps/run.gpx/webapp/src/lib/strapi.ts
  - apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts
tech-stack:
  added: []
  patterns:
    - "Nested Strapi populate of a relation's component (coordinates) and media (markerImage/photo url+formats) via granular populate[...] params"
    - "poisByGpxKey reuses the byGpxKey enrichment identity space (gpxFileId as fileId OR filename) so enriched Dynamo routes receive their CMS route's POIs without changing byGpxKey's value type"
    - "POIs attached only when non-empty (field absent, not []) to avoid bloating the DynamoDB-only manifest"
key-files:
  created: []
  modified:
    - apps/run.gpx/webapp/src/lib/strapi.ts
    - apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts
decisions:
  - "Used the granular nested-populate syntax (populate[pointsOfInterest][populate][coordinates][fields][...]) — it typechecks and matches the design §2 field list; no populate=* fallback needed."
  - "POI description (Strapi type:text) is passed through as-is — NOT run through blocksToHtml (that is a blocks field renderer); escaping happens at render time in the studio (plan 03-02)."
  - "lat/lon read from the coordinates component via the existing num() guard; a POI with missing/non-finite coordinates is skipped (cannot render)."
  - "photoUrl prefers small → medium → thumbnail → original url, mirroring the existing coverImageDisplayUrl sizing logic."
  - "Enriched-route POIs keyed by poisByGpxKey.get(fileId) ?? get(fileName), mirroring the byGpxKey join; standalone routes emit r.pois directly. Multi-route POIs duplicate harmlessly (no dedupe, per design edge cases)."
metrics:
  duration: "~8m"
  completed: "2026-07-05"
status: complete
---

# Phase 3 Plan 01: Strapi POIs in the Public Manifest Summary

Filled Phase 2's empty POI seams end to end: `fetchRouteMeta()` now populates each Strapi route's related `pointsOfInterest` (coordinates + poiType + marker/photo media) and fills `CmsRouteData.pois` with a `sortOrder`-sorted `PoiMeta[]`, and the public maps manifest nests those POIs onto every `PublicMap` — standalone CMS routes from `r.pois` and Dynamo-enriched routes via a new `poisByGpxKey` lookup — so a CMS-authored route's POIs now travel with it to the studio (plan 03-02). Phase 2's best-effort/collision/grouping/caching behavior is untouched.

## What Was Built

### Task 1 — `strapi.ts` populate + fill `CmsRouteData.pois` (committed `1bac48a1`)
- `apps/run.gpx/webapp/src/lib/strapi.ts`.
- Added a nested populate of `pointsOfInterest` using granular params: scalar `fields` `name`/`description`/`poiType`/`sortOrder`, the `coordinates` component's `latitude`+`longitude`, `markerImage.url`, and `photo.url`+`formats`. The `$or` filter, `status=published`, `pagination[pageSize]=200`, `gpxFiles`/`coverImage` populate, and the 2500ms abort timeout are all unchanged.
- In the per-row loop, mapped the row's `pointsOfInterest` array into `PoiMeta[]`:
  - `lat`/`lon` = `coordinates.latitude`/`longitude` via the existing `num()` guard; a POI with missing/non-finite coordinates is **skipped**.
  - `description` passed through as-is (plain `text`, NOT `blocksToHtml`).
  - `photoUrl` = `formats.small ?? medium ?? thumbnail ?? photo.url` (undefined when no photo); `markerImageUrl` = `markerImage.url` (undefined when none).
  - `poiType`/`sortOrder`/`name` mapped straight through.
  - Sorted ascending by `sortOrder` (missing → 0) and assigned to `CmsRouteData.pois` (replacing the `[]` placeholder). Rows with no `pointsOfInterest` keep `pois: []`.
- `PoiMeta` reused unchanged (not redeclared). Updated the `PoiMeta`/`CmsRouteData`/`fetchRouteMeta()` JSDoc to reflect that pois are now populated.
- Automated grep gate (from plan): **PASS**.

### Task 2 — Manifest attaches POIs to standalone AND enriched routes (committed `6f7ec6e6`)
- `apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts`.
- After destructuring `{ byGpxKey, cmsRoutes }`, built `poisByGpxKey: Map<string, PoiMeta[]>` from every `cmsRoutes` row that has a `gpxFileId` (`poisByGpxKey.set(r.gpxFileId, r.pois)`). `PoiMeta` was already imported from `strapi.ts`.
- Enriched (DynamoDB) routes: alongside the existing `byGpxKey.get(file.fileId) ?? byGpxKey.get(file.fileName)` enrichment, looked up `poisByGpxKey.get(file.fileId) ?? poisByGpxKey.get(file.fileName)` and set `pois` on the `PublicMap` **only when non-empty** (field absent otherwise).
- Standalone CMS routes: set `pois: r.pois.length > 0 ? r.pois : undefined` on the `cms-{documentId}` `PublicMap` (omit when empty).
- Everything else unchanged: the `dynamoKeys` collision skip (a collided CMS route still contributes its POIs via `poisByGpxKey` and is not emitted twice), `mapFolder` grouping, `cmsSortOrder` ordering, post-merge empty-group drop, and the `Cache-Control: public, s-maxage=300, stale-while-revalidate=300` header.
- Automated grep gate + `npx tsc --noEmit` (from plan): **PASS** (tsc exit 0).

## Verification

- Task 1 grep gate: **PASS**.
- Task 2 grep gate: **PASS**.
- `cd apps/run.gpx/webapp && npx tsc --noEmit`: **exit 0 (clean)** against the filled `pois` contract.
- The typecheck touched the tracked build-cache file `apps/run.gpx/webapp/tsconfig.tsbuildinfo`; it was restored (`git checkout --`) and NOT committed, per the plan's incidental-artifact note. Working tree is clean.

## Deviations from Plan

None — plan executed exactly as written. The granular nested-populate syntax typechecked and required no `populate[pointsOfInterest][populate]=*` fallback. No auto-fixes (Rules 1–3) were needed; no architectural decisions (Rule 4) arose.

## Best-effort / Degradation

Preserved from Phase 2: a Strapi failure (unconfigured/unreachable/slow/non-200) still returns `{ byGpxKey: empty, cmsRoutes: [] }`, so `poisByGpxKey` is empty, no route carries `pois`, and the manifest degrades to the DynamoDB-only result with the `s-maxage=300` header intact. Only PUBLISHED POIs reach the unauthenticated manifest (the `status=published` root filter is unchanged).

## Known Stubs

None. Phase 2's `pois: []` / unset `PublicMap.pois?` seams are now filled. The studio-side rendering of these POIs is plan 03-02 (out of scope here — this plan delivers the data path only).

## Threat Surface

No new surface beyond the plan's `<threat_model>`:
- **T-03-01 (Information Disclosure):** `status=published` root filter preserved — draft/unpublished POIs never reach the unauthenticated manifest; marker/photo URLs are public CMS (`cms.defcon.run`) assets, no presign/credential leak.
- **T-03-02 (XSS):** POI `description` is a plain `text` field passed through as a string (no `blocksToHtml`, no raw-HTML passthrough introduced); `name`/`description`/`photoUrl` are escaped at render time by the studio (plan 03-02).
- **T-03-03 (Tampering, accept):** coordinates are `num()`-guarded; a POI with non-finite lat/lon is skipped, so no NaN marker can enter the manifest.

## Self-Check: PASSED
- `apps/run.gpx/webapp/src/lib/strapi.ts` — FOUND (commit `1bac48a1`)
- `apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts` — FOUND (commit `6f7ec6e6`)
- Commit `1bac48a1` — FOUND
- Commit `6f7ec6e6` — FOUND
