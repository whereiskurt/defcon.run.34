---
phase: 02-standalone-strapi-routes
plan: 02
subsystem: run.gpx
tags: [strapi, manifest, standalone-routes, cms-native, mapFolder, collision]
requires:
  - "Route.mapFolder (string, default \"DEF CON 34 Maps\") from plan 02-01"
provides:
  - "fetchRouteMeta() two-part return { byGpxKey, cmsRoutes } — consumed by manifest and (Phase 3) POI attach"
  - "PoiMeta + CmsRouteData interfaces (strapi.ts) — Phase-3 POI seam"
  - "Standalone CMS route emission in /api/gpx/public/maps (cms-{documentId} PublicMaps, cms-folder-{slug} synthetic groups)"
  - "Optional pois? seam on the manifest PublicMap type"
affects:
  - apps/run.gpx/webapp/src/lib/strapi.ts
  - apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts
tech-stack:
  added: []
  patterns:
    - "Strapi is now BOTH a right-join enrichment source (byGpxKey) AND a left source of routes (cmsRoutes) from one fetch"
    - "Namespaced synthetic ids (cms-{documentId}, cms-folder-{slug}) to guarantee no collision with DynamoDB UUIDs"
    - "DynamoDB-wins collision skip via a union Set of every active fileId AND fileName"
key-files:
  created: []
  modified:
    - apps/run.gpx/webapp/src/lib/strapi.ts
    - apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts
decisions:
  - "byGpxKey preserves the enrichment join byte-for-byte (same RouteMeta value, keyed only by gpxFileId); rows without a gpxFileId contribute only to cmsRoutes (D1/D2)."
  - "CMS media downloadUrl is used as-is (no getSignedUrl) — it is a public CloudFront asset, not an S3-uploads object."
  - "mapFolder default 'DEF CON 34 Maps' applied in strapi.ts so route.ts groups on an already-defaulted value; synthetic cms-folder-{slug} only when the name matches no GLOBAL folder (D3)."
  - "POIs NOT implemented — only the PoiMeta interface and pois: [] / PublicMap.pois? seam left for Phase 3; pointsOfInterest is deliberately not populated."
metrics:
  duration: "~12m"
  completed: "2026-07-05"
status: complete
---

# Phase 2 Plan 02: Standalone Strapi Routes in the Public Manifest Summary

Turned Strapi from an enrichment-only right-join into ALSO a left source of routes: `fetchRouteMeta()` now returns `{ byGpxKey, cmsRoutes }` and the public maps manifest emits each CMS-native route (a route with a `gpxFiles` asset and no matching GLOBAL DynamoDB route) as a first-class `cms-{documentId}` `PublicMap` folded into its `mapFolder` group, while a route colliding with a DynamoDB route stays enrichment-only (DynamoDB wins, no double-render). POI attach is deferred to Phase 3 — only the seam is present.

## What Was Built

### Task 1 — Widen `fetchRouteMeta()` (committed `6ffe79fe`)
- `apps/run.gpx/webapp/src/lib/strapi.ts`.
- Added `interface PoiMeta` (`name`, `description?`, `lat`, `lon`, `poiType?`, `markerImageUrl?`, `photoUrl?`, `sortOrder?`) documented as the Phase-3 seam — declared but never populated in Phase 2.
- Added `interface CmsRouteData` (`documentId`, `gpxFileId?`, `gpxUrl?`, `gpxName?`, `mapFolder`, `sortOrder?`, `meta: RouteMeta`, `pois: PoiMeta[]`).
- Widened the query filter from the single `filters[gpxFileId][$notNull]` to a `$or`: `filters[$or][0][gpxFileId][$notNull]` OR `filters[$or][1][gpxFiles][$notNull]` — so CMS-native routes with no `gpxFileId` are included. Kept `status=published` and the `pagination[pageSize]=200` cap.
- Added `mapFolder` and `sortOrder` to the `fields` list; added `populate[gpxFiles]` for `url` + `name` (first asset is the route's GPX). Left the existing `coverImage` populate intact. Did NOT populate `pointsOfInterest` (Phase 3).
- Changed the return from `Map<string, RouteMeta>` to `{ byGpxKey: Map<string, RouteMeta>; cmsRoutes: CmsRouteData[] }`:
  - Builds the same `RouteMeta` object per row as before (including `blocksToHtml` sanitization — the XSS control, unchanged, no raw HTML passthrough introduced).
  - Pushes one `CmsRouteData` per row into `cmsRoutes` (`gpxUrl`/`gpxName` from the first `gpxFiles` entry, `mapFolder` defaulted to `"DEF CON 34 Maps"` when null/empty, `pois: []`).
  - Only rows WITH a `gpxFileId` also `byGpxKey.set(gpxFileId, meta)` — the enrichment join value is byte-for-byte the old map's.
  - Best-effort preserved: 2500ms abort timeout + try/catch; error/unconfigured path returns empty `byGpxKey` + empty `cmsRoutes`.
- Automated gate (from plan): **PASS**.

### Task 2 — Manifest standalone emission (committed `a2867cc3`)
- `apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts`.
- Destructured `const { byGpxKey, cmsRoutes } = await fetchRouteMeta()`; replaced the old `cmsMeta.get(...)` enrichment lookups with `byGpxKey.get(file.fileId) ?? byGpxKey.get(file.fileName)` — same OR-match, same folded fields (enrichment output unchanged).
- Made `groups` a mutable `MapGroup[]` of `{ folderId, folderName, maps }` (dropped the eager `mapCount`; emptiness computed from `maps.length` at the end).
- Added a pure `slug()` helper (lowercase, trim, non-alphanumeric runs → single hyphen, strip leading/trailing hyphens).
- Built `dynamoKeys`: a `Set<string>` of every active file's `fileId` AND `fileName` across all groups — the collision identity space.
- Standalone emission per `cmsRoutes` entry:
  - Skip if `!r.gpxUrl` (orphan stub).
  - Skip if `r.gpxFileId && dynamoKeys.has(r.gpxFileId)` (collision → DynamoDB wins; no second route).
  - Else build a `PublicMap`: `fileId: "cms-" + r.documentId`, `fileName: r.gpxName ?? r.documentId`, `downloadUrl: r.gpxUrl` (public CMS media, NO `getSignedUrl`), CMS meta folded from `r.meta`; `bounds` left undefined (studio derives it in 02-03); DynamoDB-only fields omitted; `pois` seam unset.
  - Target group by `folderName === r.mapFolder`, reusing the GLOBAL folder's `folderId`; else create `{ folderId: "cms-folder-" + slug(mapFolder), folderName, maps }` and push it.
- Ordering: CMS-emitted entries (`cms-` prefix) in touched groups sorted by ascending `sortOrder` (missing sorts as 0); DynamoDB maps kept ahead of appended CMS routes in a shared group.
- Empty-group drop applied AFTER the merge (`maps.length > 0`); `Cache-Control: public, s-maxage=300, stale-while-revalidate=300` preserved exactly.
- Added optional `pois?: PoiMeta[]` to the `PublicMap` type (imported `PoiMeta` from strapi.ts) as the Phase-3 seam — never set.
- Kept the outer try/catch and 500 fallback; manifest still returns DynamoDB-only unchanged when `cmsRoutes` is empty.
- Automated gate (from plan): **PASS**.

## Verification

- Task 1 grep gate: **PASS**.
- Task 2 grep gate: **PASS**.
- `cd apps/run.gpx/webapp && npx tsc --noEmit`: **exit 0 (clean)** against the new two-part return contract. (The plan allowed `tsc --noEmit` in lieu of the full Next.js build; typecheck is the relevant gate for a pure type-contract change.)

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes (Rules 1–3) were needed; no architectural decisions (Rule 4) arose.

## Phase 3 Seams (intentionally NOT implemented here)

- `PoiMeta` interface declared in strapi.ts but never populated; `CmsRouteData.pois` is always `[]`.
- `PublicMap.pois?` optional field present but never set.
- `pointsOfInterest` is deliberately NOT populated in the Strapi query.
- Standalone CMS routes emit `bounds: undefined` — client-side bbox derivation is plan 02-03.

## Known Stubs

`pois: []` (strapi.ts) and the unset `PublicMap.pois?` (route.ts) are intentional Phase-3 seams, documented in the plan's `<artifacts_this_phase_produces>` and resolved by Phase 3. No stub prevents this plan's goal (standalone routes on the public map) from being achieved.

## Threat Surface

No new surface beyond the plan's `<threat_model>`. T-02-03 (status=published preserved), T-02-04 (blocksToHtml sanitization untouched, no raw HTML passthrough), T-02-05 (cms- namespacing + dynamoKeys collision skip), and T-02-06 (2500ms abort + empty fallback) mitigations are all in place.

## Self-Check: PASSED
- `apps/run.gpx/webapp/src/lib/strapi.ts` — FOUND (commit `6ffe79fe`)
- `apps/run.gpx/webapp/src/app/api/gpx/public/maps/route.ts` — FOUND (commit `a2867cc3`)
- Commit `6ffe79fe` — FOUND
- Commit `a2867cc3` — FOUND
