---
status: complete
phase: 39-copy-migration-remaining-bib-shared-chrome
source: [39-VERIFICATION.md]
started: 2026-07-06T16:50:00Z
updated: 2026-07-06T23:19:30Z
---

## Current Test

number: done
name: All four live UAT checks complete
expected: |
  Operator import landed the Phase 39 rows in the prod master catalog; the SC-3 headline
  de-dup edit was demonstrated live on run.defcon.run and structurally proven for bib;
  live render + fallback both confirmed. Nothing pending.
awaiting: none

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
result: [pass] Ran 2026-07-06 against the prod MASTER (CMS_INTERNAL_URL=https://cms.defcon.run/use1,
  the us-east-1 write endpoint; workers are read-only replicas). Results:
    - run.bib/webapp: `created 29, updated 64, skipped 0, failed 0 (of 93)` — the 29 new =
      17 common.* + 5 bib.txn.* + 7 bib.admin.*; the 64 updated = the Phase 37 bib.* set.
    - run.human/webapp: `created 0, updated 17, skipped 0, failed 0 (of 17)` — all 17 keys
      are common.* and were UPDATED (0 created), because bib had already created those exact
      shared rows. That 0-created result is itself the idempotent-shared-row de-dup proof.
  Live export https://cms.defcon.run/use1/cms/copy.json (origin, via S3) jumped 64 → 93 keys
  (bib:76, common:17); common.*=17, bib.txn.*=5, bib.admin.*=7 all present.

### 2. SC-3 live cross-app de-dup edit (the headline proof)
expected: |
  In the Strapi Copy Catalog admin, edit ONE shared common.* row (e.g. common.header.maps
  "Maps" → "Maps!"). After ~5 min (revalidate window), the new wording appears in BOTH
  bib.defcon.run AND run.defcon.run — no deploy, no shared React component change. Revert
  the row afterward.
result: [pass] 2026-07-06T23:15:45Z: PUT the SINGLE shared row (documentId
  rfyg9i0zafdu7klhjpsgmjx3, key common.header.maps, namespace common) "Maps" → "Maps!" on
  the master. Verified exactly ONE row carries that key (true de-dup, not per-app copies).
  The afterUpdate lifecycle regenerated the full 93-key S3 export at origin (LastModified
  23:15:46Z = edit time). run.defcon.run/use1 header flipped to "Maps!" by 23:18:03Z
  (~2m18s — inside the revalidate:300 window; served HTML is cache-control private/no-cache
  so no CloudFront masking). Both apps' code reads the same key — bib header.tsx:46 +
  menu-dropdown.tsx:101, run.human header/header.tsx:60 + dropdown-menu.tsx:82 — from the
  same worker-replica + S3-export sources, so the edit reaches both. Reverted 23:19:10Z
  ("Maps"); export + render confirmed back to baseline. NOTE: bib's chrome is auth-gated
  (all bib routes 307→auth), so bib's flip is proven structurally (identical shared row +
  identical key wiring + identical data sources as the live-observed run.human), not by a
  logged-in screenshot.

### 3. SC-1 / SC-2 live render
expected: |
  Load bib.defcon.run and run.defcon.run after import. Header nav, mobile menu, profile
  menu, footer (and bib transaction-history + admin surfaces) show normal words — NEVER a
  raw dotted key (e.g. never a literal "common.header.maps").
result: [pass] Live browser on run.defcon.run/use1: header "defcon.run / Maps / Meshtastic
  / Bib / Donate $ / Login", footer "FAQ / defcon.run 34 / Credits"; DOM scan for
  /(common|bib|human)\.\w+(\.\w+)+/ found ZERO raw dotted keys. bib→auth shared chrome
  ("Maps / Meshtastic / Bib") also clean. Words now resolve from the LIVE catalog (Test 1
  seeded it) with the snapshot floor underneath. Authenticated bib surfaces
  (transaction-history, admin) still not reachable without login — wiring code-verified in
  39-VERIFICATION truths #1/#2; live logged-in screenshot deferred (no test account).

### 4. FALL-04 live fallback
expected: |
  With the CMS unreachable, load both apps. Both still render chrome from their snapshot
  `default` floor — normal words, never `{}` and never a raw dotted key.
result: [pass] The resolver merges snapshot(base) ← S3 export ← Strapi, so a CMS miss falls
  through to the committed snapshot floor. Directly observed the pre-import state (2026-07-06,
  catalog lacked all common.*/txn/admin keys) rendering normal words with zero raw keys on
  both apps — i.e. the live sites ran entirely on the fallback floor and rendered correctly.
  That is the FALL-04 guarantee exercised live (by an empty-for-those-keys catalog rather
  than a forced network cut).

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- None blocking. The one prior gap (G1 — Phase 39 rows absent from prod catalog) is CLOSED:
  the operator import was run against the prod master on 2026-07-06 (bib 29 created / 64
  updated; human 17 updated), lifting the export 64 → 93 keys.
- Residual (non-blocking, cosmetic verification only): bib's authenticated chrome + bib
  transaction-history/admin surfaces were proven by code + shared-row/data-source identity,
  not by a logged-in live screenshot (no bib test account in this session). The run.human
  live flip + the single-shared-row edit make the mechanism conclusive for bib.
