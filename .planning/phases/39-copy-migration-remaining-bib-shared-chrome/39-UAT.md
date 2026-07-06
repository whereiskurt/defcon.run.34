---
status: testing
phase: 39-copy-migration-remaining-bib-shared-chrome
source: [39-VERIFICATION.md]
started: 2026-07-06T16:50:00Z
updated: 2026-07-06T16:50:00Z
---

## Current Test

number: 1
name: Operator import — seed the shared Strapi catalog with the authored rows
expected: |
  With CMS_INTERNAL_URL + STRAPI_WRITE_TOKEN exported (write-capable token, distinct
  from the runtime read-only STRAPI_API_TOKEN), `npm run copy:import` in
  apps/run.bib/webapp AND apps/run.human/webapp each prints a created/updated tally and
  exits 0; common.*/bib.*/human.* rows land once in the shared catalog under the correct
  per-key namespace (idempotent upsert by key). The write token is supplied only at import
  time — never committed, never in runtime env.
awaiting: user response

## Tests

### 1. Operator import
expected: |
  ```
  export CMS_INTERNAL_URL="<reachable Strapi base URL>"
  export STRAPI_WRITE_TOKEN="<write-capable token, distinct from runtime read-only STRAPI_API_TOKEN>"
  cd apps/run.bib/webapp && npm run copy:import
  cd ../../run.human/webapp && npm run copy:import
  ```
  Each prints `created N, updated N, skipped 0, failed 0` and exits 0. Namespace is derived
  per key (common.*→common, bib.*→bib, human.*→human); upsert is idempotent by key so the
  shared common.* rows land once.
result: [pending]

### 2. SC-3 live cross-app de-dup edit (the headline proof)
expected: |
  In the Strapi Copy Catalog admin, edit ONE shared common.* row (e.g. common.header.maps
  "Maps" → "Maps!"). After ~5 min (revalidate window), the new wording appears in BOTH
  bib.defcon.run AND run.defcon.run — no deploy, no shared React component change. Revert
  the row afterward.
result: [pending]

### 3. SC-1 / SC-2 live render
expected: |
  Load bib.defcon.run and run.defcon.run after import. Header nav, mobile menu, profile
  menu, footer (and bib transaction-history + admin surfaces) show normal words — NEVER a
  raw dotted key (e.g. never a literal "common.header.maps").
result: [pending]

### 4. FALL-04 live fallback
expected: |
  With the CMS unreachable, load both apps. Both still render chrome from their snapshot
  `default` floor — normal words, never `{}` and never a raw dotted key.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
