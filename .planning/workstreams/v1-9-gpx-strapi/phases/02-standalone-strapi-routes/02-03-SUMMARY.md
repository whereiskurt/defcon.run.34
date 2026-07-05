---
phase: 02-standalone-strapi-routes
plan: 03
subsystem: run.gpx
tags: [strapi, standalone-routes, bounds-fallback, cloudfront, cors, risk-1]
requires:
  - "Standalone CMS route emission with bounds:undefined from plan 02-02 (cms-{documentId} PublicMaps)"
  - "The /{region}/cms/* cms-media CloudFront behavior (existing, no CORS policy)"
provides:
  - "Client-side bounds fallback in public-overlays.ts (boundsFromGeoJSON) — standalone CMS routes fit on toggle"
  - "aws_cloudfront_response_headers_policy.cms_media_cors — gpx-origin-scoped CORS on the CMS media behavior (Risk 1)"
affects:
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts
  - infra/terraform/modules/cloudfront/v1.0.0/main.tf
tech-stack:
  added: []
  patterns:
    - "Client-side bbox derivation from parsed GPX GeoJSON when the manifest supplies no precomputed bounds — fallback only, precomputed m.bounds still wins"
    - "CloudFront response-headers CORS policy scoped to a single studio origin (no wildcard) for a public media distribution"
key-files:
  created: []
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts
    - infra/terraform/modules/cloudfront/v1.0.0/main.tf
decisions:
  - "Bounds fallback populates the SAME this.routeBounds map fitToRoutes() already reads; fitToRoutes() and the toggle handlers are unchanged — populating the map is the whole fix."
  - "boundsFromGeoJSON is guarded three ways: only runs when routeBounds lacks the fileId (precomputed m.bounds wins), returns null on empty/no-coordinate geometry so a degenerate/NaN box is never cached, and runs inside the existing per-route try/catch so one bad route can't break others."
  - "CORS is the chosen PRIMARY fix for Risk 1 (response-headers policy on the cms-media behavior); the same-origin proxy in run.gpx is the documented CONTINGENCY, not built."
  - "access_control_allow_origins scoped to https://gpx.${var.dns.zonename} only — NO '*' wildcard (T-02-07); methods GET/HEAD/OPTIONS, headers '*', credentials disabled, origin_override=true."
  - "The .gpx is fetched as text and parsed (parseGPX), never drawn to a canvas, so cross-origin needs only Access-Control-Allow-Origin — no canvas-taint concern (T-02-08 accept). Marker-image canvas taint is Phase-3 Risk 3, out of scope."
metrics:
  duration: "~10m"
  completed: "2026-07-05"
status: complete
---

# Phase 2 Plan 03: Standalone-Route Rendering + Delivery Summary

Closed the standalone-route loop on the studio + infra side. A CMS-authored route now arrives from the manifest (plan 02-02) with no precomputed `bounds`, so `public-overlays.ts` derives a bounding box client-side from the parsed GPX GeoJSON when `m.bounds` is absent — the same `[[minLon,minLat],[maxLon,maxLat]]` box `fitToRoutes()` already consumes — so toggling a CMS route on frames it like any DynamoDB route. And the `/{region}/cms/*` CloudFront behavior now carries a gpx-origin-scoped CORS response-headers policy (Risk 1) so the studio at `gpx.defcon.run` can cross-origin `fetch()` the `.gpx` from the CMS media distribution at `cms.defcon.run`. No infra apply / deploy in this phase — the deliverable is the validated code + terraform.

## What Was Built

### Task 1 — Client-side bounds fallback (committed `181a187f`)
- `apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts`.
- Added a pure module-level helper `boundsFromGeoJSON(fc)` that walks a parsed FeatureCollection's geometry coordinates (`LineString` / `MultiLineString` from `toGeoJSON()` tracks, plus `Point` defensively) and returns `[[minLon,minLat],[maxLon,maxLat]]`, or `null` when no finite coordinates are seen (never returns a degenerate/NaN box). Non-finite lon/lat pairs are skipped.
- In `add()`'s per-route load block: captured the parsed GeoJSON once (`const geojson = file.toGeoJSON()`), passed it to `setRouteData(m.fileId, geojson)`, then — **only when `!this.routeBounds.has(m.fileId)`** (so the existing `m.bounds` pre-cache path wins) — derived `boundsFromGeoJSON(geojson)` and, **only when a real box comes back**, stored it in `this.routeBounds`.
- The fallback runs inside the existing per-route `try/catch`, so a parse quirk on one route cannot break others.
- Did NOT change the line/glow/POI layers, the manifest fetch, or `fitToRoutes()` — `fitToRoutes()` already reads `this.routeBounds`, so populating that map is the entire fix. Change is ~40 lines incl. the helper and comments.
- Automated gate (from plan): **PASS** (`boundsFromGeoJSON` + `routeBounds.has` present).

### Task 2 — CORS on the CMS media CloudFront behavior (committed `82ebf948`)
- `infra/terraform/modules/cloudfront/v1.0.0/main.tf`.
- Confirmed the Risk 1 gap: the `/{region}/cms/*` `ordered_cache_behavior` (guarded by `each.key == "cms"`, target `cms-media-*`) carried no `response_headers_policy`, so CloudFront emitted no `Access-Control-Allow-Origin` and the studio's cross-origin `fetch()` would fail.
- Added `resource "aws_cloudfront_response_headers_policy" "cms_media_cors"` (name `cms-media-cors-${var.dns.zonename}`, `provider = aws.global-application`, placed with the other global resources) with a `cors_config`:
  - `access_control_allow_origins` = `["https://gpx.${var.dns.zonename}"]` — scoped to the studio origin, **no `*` wildcard**.
  - `access_control_allow_methods` = `GET, HEAD, OPTIONS`.
  - `access_control_allow_headers` = `["*"]` (minimal for a public read).
  - `access_control_allow_credentials` = `false`; `origin_override = true`.
- Referenced it from the cms-media behavior via `response_headers_policy_id = aws_cloudfront_response_headers_policy.cms_media_cors.id`. Left `cache_policy_id` (Managed-CachingOptimized) and `allowed_methods`/`cached_methods` unchanged; the behavior remains guarded to the `cms` domain only, so gpx / auth / run-human distributions are unaffected.
- Automated gate (from plan): **PASS** (`response_headers_policy` + `cors_config`/`response_headers_policy_id` present; `terraform fmt` clean).

**Contingency (documented, not built):** if CORS ever proves impossible, the fallback is a small same-origin proxy route in run.gpx that streams the CMS `.gpx` so the studio fetches from its own origin. CORS is the chosen primary path.

## Verification

- Task 1 grep gate: **PASS**.
- Task 2 grep gate: **PASS**.
- `terraform fmt -check main.tf`: **already-formatted** (no reformat needed).
- `terraform validate`: **not run to completion in this env** — errors are `Missing required provider` (`hashicorp/aws`, `hashicorp/random`) because the module has not had `terraform init` in this worktree. This is the expected toolchain/env limitation the plan marked best-effort/out-of-scope, NOT a syntax error in the change. The added HCL is standard `aws_cloudfront_response_headers_policy` shape and `terraform fmt` accepted it.
- `./apps/run.gpx/build-frontend.sh`: **CLEAN** — the studio compiled with the Task 1 change (`✓ built in 31.37s`, `Wrote site to "build"`, `=== Build complete ===`). Proves the `boundsFromGeoJSON` + `add()` edit type-checks and bundles.

## Build Artifacts (not committed — per plan)

`build-frontend.sh` regenerates compiled studio output (`apps/run.gpx/webapp/public/studio/**`, `apps/run.gpx/gpx-studio/website/build/**`, `.svelte-kit/**`). In this repo those paths are **gitignored**, so the build produced **zero** tracked modifications and **zero** untracked files — the working tree returned fully clean on its own (no `git checkout`/`git clean` needed). Only the two source commits (`public-overlays.ts`, `main.tf`) plus this SUMMARY are the plan's deliverable; the compiled bundle ships in a separate release/deploy step.

## Deploy Scope

The terraform change (CORS policy + behavior reference) takes effect ONLY on a CloudFront apply/deploy, which is **OUT OF SCOPE** for this phase — release + `terraform apply` are separate steps. The deliverable is the validated terraform, not a live-deployed distribution.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes (Rules 1–3) were needed; no architectural decisions (Rule 4) arose.

## Threat Surface

No new surface beyond the plan's `<threat_model>`.
- **T-02-07** (CORS allow-list) mitigated: `access_control_allow_origins` scoped to `https://gpx.${var.dns.zonename}`, no `*` wildcard, methods limited to GET/HEAD/OPTIONS, credentials disabled.
- **T-02-08** (canvas taint) accepted: the `.gpx` is fetched as text and `parseGPX`-parsed, never canvas-drawn, so only `Access-Control-Allow-Origin` is required.

## Known Stubs

None. No POI work here (Phase 3). The bounds fallback and CORS policy are both complete and functional as source; the only unexecuted step (CloudFront apply) is an intentional, plan-documented out-of-scope release action.

## Open Verification Items

- `terraform validate` not confirmed in this environment (needs `terraform init` / provider download — out of scope). `terraform fmt` clean; recommend a `validate` + `plan` on the next infra apply pass.

## Self-Check: PASSED
- `apps/run.gpx/gpx-studio/website/src/lib/components/map/public-overlays.ts` — FOUND (commit `181a187f`)
- `infra/terraform/modules/cloudfront/v1.0.0/main.tf` — FOUND (commit `82ebf948`)
- Commit `181a187f` — FOUND
- Commit `82ebf948` — FOUND
