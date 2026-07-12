# cloudfront-region-prefix module (v1.0.0)

A reusable pair of CloudFront Functions that ensure every request path carries
a served-region segment (`/use1/`, `/cac1/`, `/apse1/`). Attach to **any**
distribution that fronts a region-partitioned origin (run.human today; the
`q.` resolver distro later).

**Status: authored for review, NOT wired to any live unit, NOT applied.**

## Why this exists

run.human is mounted per-region via Next.js `basePath` (`/use1`, …), so a path
**without** a region segment 404s. Today the run.human distribution's only
viewer-request function (`modules/cloudfront/v1.0.0` `root_redirect`) is a
**no-op** — so `run.defcon.run/orderform` currently 404s. This module is the
real prefixer that closes that gap, and it lets the `q.` resolver emit **bare**
`run.defcon.run/…` URLs (region decided here, at the edge, not in the Lambda).

## Behavior

**viewer-request** (`region-prefix.js`): if the path's first segment is already
a served region → pass through (idempotent). Otherwise choose a region and
prepend `/<region>`:

- `geo_enabled = true` (multi-region): sticky **cookie** (if it names a served
  region) → **country-of-origin** (`CloudFront-Viewer-Country` → `country_region_map`)
  → **default_region**.
- `geo_enabled = false` (single-region / override): always `default_region`.
  No cookie, no country lookup — the cheap path.

**viewer-response** (`region-cookie.js`): echoes the chosen region into a sticky
`dcr_region` cookie. **Only created on multi-region deploys** — nothing to
remember with one region.

## The single- vs multi-region switch

`geo_enabled` defaults to `length(served_regions) > 1`:

| Deploy | `served_regions` | request fn | response (cookie) fn | Effect |
|--------|------------------|-----------|----------------------|--------|
| single-region (today) | `["use1"]` | static `/use1` prefix | not created | everything → `/use1/…`, no lookup |
| multi-region (future) | `["use1","cac1","apse1"]` | geo+cookie+default | created | per-viewer region, sticky |
| override | any + `geo_enabled=false` | static default | not created | force single-region behavior |
| off | any + `enabled=false` | none | none | you prefix another way |

`country_region_map` is the **geo seam** — default `{}` (everyone → default even
when geo is on). Populate it (`{ CA = "cac1", SG = "apse1", … }`) when cac1/apse1
actually serve; values not in `served_regions` are ignored at runtime.

> **Reality check (2026-07-12):** only `use1` serves — `cac1`/`ap-southeast-1`
> are in `skip_regions` (`site.hcl:8`), so they have no ALB/app (and no DynamoDB
> replica). So today this ships single-region (`["use1"]`): static `/use1`
> prefix, no geo, no cookie fn. The geo path lights up when those regions un-skip.

## Wiring it later (follow-up; requires a prod-edge deploy)

1. `module "region_prefix" { source = ".../cloudfront-region-prefix/v1.0.0"; served_regions = […]; default_region = "use1"; name_suffix = "<site>-<region>"; }`
2. On the run.human distribution (`modules/cloudfront`), replace the no-op
   `root_redirect` viewer-request association with
   `module.region_prefix.request_function_arn`, and add a viewer-response
   association with `response_function_arn` **when non-empty**.
3. To use geo, forward `CloudFront-Viewer-Country` via the cache policy (the
   current `AllViewerExceptHostHeader` origin-request policy does **not** add it).
4. Reuse the same module on the future `q.` resolver distro so its bare
   `run.defcon.run/…` redirects get prefixed on arrival.
