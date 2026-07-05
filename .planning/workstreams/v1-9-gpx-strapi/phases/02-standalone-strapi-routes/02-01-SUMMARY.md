---
phase: 02-standalone-strapi-routes
plan: 01
subsystem: run.cms
tags: [strapi, content-type, route, mapFolder, gpx-upload]
requires: []
provides:
  - "Route.mapFolder (string, default \"DEF CON 34 Maps\") — consumed by manifest in plan 02-02"
affects:
  - apps/run.cms/app/src/api/route/content-types/route/schema.json
tech-stack:
  added: []
  patterns: ["free-text mapFolder over enum (D3) — new map groups need no schema change"]
key-files:
  created: []
  modified:
    - apps/run.cms/app/src/api/route/content-types/route/schema.json
decisions:
  - "mapFolder is free-text (not enum) and defaulted, not required — additive, non-destructive schema sync (D3)."
  - "config/plugins.ts left unchanged: .gpx upload whitelist is contingent-only and no live Strapi was reachable to observe a rejection."
metrics:
  duration: "~5m"
  completed: "2026-07-05"
status: complete
---

# Phase 2 Plan 01: CMS Route.mapFolder + .gpx Upload Verification Summary

Added the non-required free-text `Route.mapFolder` string attribute (default "DEF CON 34 Maps") to the Strapi Route content-type so curators can place a standalone route into a public-map group; the `.gpx` upload behavior (Risk 2) could not be observed live and is recorded as an open manual-verification item with `config/plugins.ts` left unchanged.

## What Was Built

### Task 1 — Route.mapFolder field (committed `9e52722c`)
- Added `mapFolder` to `attributes` in `apps/run.cms/app/src/api/route/content-types/route/schema.json`, placed adjacent to the other map/display config scalars (after `mapOpacity`, before `sortOrder`).
- Shape: `{ "type": "string", "default": "DEF CON 34 Maps" }` — not `required`.
- Default is a character-for-character match to the primary GLOBAL "DEF CON 34 Maps" folder name, so the manifest's name match in plan 02-02 succeeds without synthesizing a group even before a curator sets the field.
- Automated gate (from plan): `node -e` assertion on type/default/non-required → **PASS**.
- Verified the JSON still parses (the `require()` in the gate would have thrown otherwise).

### Task 2 — .gpx upload verification (Risk 2)
- **Structural precondition (PASS):** `Route.gpxFiles` is a `media` field whose `allowedTypes` includes `"files"`. The plan's `node -e` gate confirms only this shape — it does NOT confirm an actual upload.
- **Confirmation outcome — OPTION (b): NOT PERFORMED, OPEN ITEM.** No local/running Strapi was reachable during execution (`curl http://localhost:1337` returned `000` / connection refused). Per the plan's strengthened acceptance criteria, the passing structural gate is explicitly NOT treated as upload confirmation.
- **`config/plugins.ts` unchanged.** The upload whitelist is a contingency that the plan directs to apply ONLY if the uploader is observed to reject `.gpx`. With no Strapi to observe a rejection, no defensive/proactive patch was applied, keeping the change surface minimal and the config factory intact.

## Deviations from Plan

None — plan executed as written. Task 2's live upload was intentionally deferred (not skipped): the plan pre-authorized option (b) when no Strapi is reachable.

## Open Manual-Verification Items

1. **`.gpx` upload into `Route.gpxFiles` (Risk 2) — UNVERIFIED.** No Strapi instance was running in this environment.
   - **How to verify:** `cd apps/run.cms/app && npm run develop` (admin at :1337) → open/create a Route → upload a small real `.gpx` into `gpxFiles`.
   - **Expected:** accepts as-is (the field already allows `"files"`; a `.gpx` is a non-media "file").
   - **If rejected:** add a scoped `.gpx`/gpx-mime (`application/gpx+xml`, fallbacks `application/xml` / `text/xml` / `application/octet-stream`) whitelist to the `upload` block in `config/plugins.ts` — do NOT loosen `gpxFiles.allowedTypes` beyond `"files"` and do NOT whitelist executable/script mimes (threat T-02-01). Re-run the upload to confirm.
   - **Impact if unaddressed:** the standalone-route path in plan 02-02 is inert if no GPX can be attached.

## Threat Notes

- T-02-01 (upload whitelist tampering): no whitelist was added, so no new upload surface was introduced this plan. If the open item above requires a whitelist, it must stay scoped to `.gpx`/gpx-xml mimes.
- T-02-02 (mapFolder free-text disclosure): `mapFolder` is authored by trusted admins and rendered downstream via the studio's existing `escapeHtml` (plan 02-03). No new surface.

## Verification Results

- `attributes.mapFolder` — `string`, default `"DEF CON 34 Maps"`, not required → PASS
- `schema.json` parses as valid JSON → PASS
- `Route.gpxFiles` remains `media` allowing `"files"` → PASS (structural)
- `point-of-interest` schema untouched → confirmed (not edited)
- No other Route attribute added/removed/retyped → confirmed (diff = 4 insertions only)

## Self-Check: PASSED

- FOUND: `apps/run.cms/app/src/api/route/content-types/route/schema.json` (mapFolder present)
- FOUND commit: `9e52722c` (feat(02-01): add free-text Route.mapFolder field)
