---
phase: 2
phase_slug: standalone-strapi-routes
workstream: v1-9-gpx-strapi
status: passed
verified: 2026-07-05
method: static-inspection + build
---

# Phase 2 — Standalone Strapi routes — Verification

**Goal:** A published Strapi `Route` with an attached GPX and no matching GLOBAL DynamoDB route
renders as a first-class route on the public map (from CMS media GPX), folded into the GLOBAL
group named by `Route.mapFolder` (synthesized if absent, ordered by `sortOrder`); a Strapi route
matching an existing `gpxFileId` stays enrichment-only (DynamoDB wins, no double-render);
standalone routes fit on toggle via a client-side bounds fallback. Verify CMS `.gpx` CORS +
Strapi `.gpx` upload whitelist.

**Requirements:** GPXCMS-02, GPXCMS-03, GPXCMS-04, GPXCMS-05.

## Static / build checks (evidence)

| Design-contract item (req) | Result | Evidence |
|---|---|---|
| `Route.mapFolder` free-text field, default "DEF CON 34 Maps" (GPXCMS-02) | ✅ | `apps/run.cms/.../route/schema.json` — `mapFolder` string, default set |
| `fetchRouteMeta` filter widened `gpxFileId notNull OR gpxFiles notNull`; two-part `{ byGpxKey, cmsRoutes }` return; enrichment join preserved (GPXCMS-03) | ✅ | `strapi.ts:59` `CmsRouteData`, `:174` return type; `$or` filter + populate; best-effort empty fallback documented; `tsc --noEmit` exit 0 |
| Standalone emission: `fileId:"cms-{documentId}"`, `downloadUrl = r.gpxUrl` (no presign), orphan-stub skip (GPXCMS-03) | ✅ | `route.ts:158` `"cms-" + r.documentId`, `:172` `downloadUrl: r.gpxUrl`, `:153` `if (!r.gpxUrl) continue`; presign (`getSignedUrl`) confined to the DynamoDB path (`:98`) |
| `mapFolder` grouping: reuse GLOBAL folderId else synthesize `cms-folder-{slug}`; `sortOrder` ordering; empty-group drop AFTER merge (GPXCMS-04) | ✅ | `route.ts:181` `"cms-folder-" + slug(...)`, `:195` sortOrder map, `:209` `groups.filter(g => g.maps.length > 0)` |
| Collision → DynamoDB wins, no double-render (GPXCMS-04, D1/D2) | ✅ | `route.ts:141` `dynamoKeys` set (fileId + fileName), `:155` `if (r.gpxFileId && dynamoKeys.has(r.gpxFileId)) continue` |
| Client-side bounds fallback only when `m.bounds` absent (GPXCMS-05) | ✅ | `public-overlays.ts:149` `boundsFromGeoJSON()`, `:377` guarded `if (!this.routeBounds.has(m.fileId))`; precomputed path unchanged |
| `Cache-Control: public, s-maxage=300, stale-while-revalidate=300` preserved | ✅ | `route.ts:215` |
| Risk 1 — CMS-media CORS for studio origin | ✅ (code) | `main.tf:134` `aws_cloudfront_response_headers_policy.cms_media_cors` scoped to `https://gpx.${var.dns.zonename}`, wired at `:374` on the `/{region}/cms/*` behavior |
| Phase 3 seam clean (POIs NOT implemented) | ✅ | only `PoiMeta`, `pois: []`, `PublicMap.pois?` stubs; `pointsOfInterest` not populated |
| gpx-studio frontend builds clean | ✅ | `./build-frontend.sh` → `✓ built in 31.37s`, "Build complete" |

## Verdict

**PASSED (code-complete).** All four requirements implemented faithfully to the design contract;
studio builds clean; typecheck clean.

## Open items (require running stack / deploy — cannot verify statically)

1. **Functional UAT:** a published CMS Route with a `.gpx` attached actually appears on
   `gpx.defcon.run` under its `mapFolder` group, does not double-render on `gpxFileId` collision,
   and fits on toggle — needs a running Strapi + the manifest endpoint + browser check.
2. **Risk 2 — `.gpx` upload whitelist (from 02-01):** the observational upload into `Route.gpxFiles`
   was NOT performed (no local Strapi in the exec env). One-time manual check: `npm run develop`
   at :1337, upload a `.gpx`; whitelist `config/plugins.ts` (gpx/xml mimes) only if rejected.
3. **CORS deploy:** `main.tf` change is code-only. `terraform validate` could not run (module not
   `init`-ed in this env); no apply. Needs `terragrunt plan/apply` on the cms CloudFront to activate,
   then a cross-origin `fetch()` check from the studio origin.

## Commits
- `9e52722c` mapFolder field · `4a61b5b1` 02-01 summary
- `6ffe79fe` fetchRouteMeta two-part return · `a2867cc3` manifest standalone emission · `cf5e7b6d` 02-02 summary
- `181a187f` bounds fallback · `82ebf948` CMS-media CORS · `5551b454` 02-03 summary
