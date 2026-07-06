# 38-03 — Human-Verify: Custom Copy Admin Page (end-to-end)

**Plan:** 38-03 (checkpoint:human-verify, blocking)
**Requirements:** ADMN-01, ADMN-02, ADMN-03
**Status:** ✅ Verified against a live CMS build (local dev env, Strapi 5.33, SQLite)
**Verified:** 2026-07-06

## How it was verified

Booted `run.cms` locally (`npm run develop`, `CMS_MODE=master`, seeded admin + ~23
`ui-string` rows across namespaces), reached an authenticated admin session, and drove
the page in a real browser plus a deterministic bulk-upsert API suite. Not just
`npm run build` — the affected flows were exercised and observed.

## Success criteria — all observed

| Criterion | Result |
|-----------|--------|
| ADMN-01 · menu link + region-prefixed route resolves (`/use1/admin/copy-catalog`) | ✅ (the D-01 empirical open item) |
| ADMN-01 · three-column Label·Locale·Value grid, inline edit, add-row | ✅ |
| ADMN-01/D-05 · add-row inherits the active namespace prefix (`bib.`) | ✅ |
| ADMN-02 · client-side namespace filter narrows the grid (bib → 4 rows) | ✅ (+ added free-text key/value search) |
| ADMN-03 · bulk Save upserts dirty+new rows | ✅ (create persists derived `namespace`; T1) |
| ADMN-03 · in-place edit updates, not duplicates | ✅ (same id, row count unchanged; T2) |
| ADMN-03/D-03 · atomic reject on `(key,locale)` collision — nothing written | ✅ (batch-dup T3, existing-collision T5; per-row errors + banner) |
| ADMN-03 · bad namespace prefix rejected | ✅ (`BAD_NAMESPACE_PREFIX`; T4) |
| FALL-01 reuse · copy.json S3 export fires on master; graceful no-op w/o S3 creds | ✅ (logged skip locally; real upload needs prod creds — not locally testable) |
| Auth · unauthenticated / read-only-token POST denied | ✅ (401 on admin route; content-API bulk removed) |

## Defect found and fixed during verification

**Blocker (build-green, runtime-broken):** the page called the content API
(`/api/ui-strings`) with the admin session JWT, which Strapi rejects (401) — the grid
could not load and Save could not post. Root cause: Strapi forces every `src/api`
route to `type: 'content-api'`, so admin-session endpoints must live on the admin
router. Fixed by registering `/copy-catalog/ui-strings` (+ `bulk-upsert`) on the admin
router in `register()` (commit `fix(38): serve Copy Catalog via admin-authed routes`).
The `/api/ui-strings` read path (read-only API token) is left intact for the Phase-36
toolkit. This is exactly the class of bug the blocking human-verify gate exists to
catch — `npm run build` passed clean.

## UI iterations (post-verify polish, per review)

The initial DS field-per-cell grid was too sparse. Rebuilt as a dense native-table
spreadsheet (compact rows, monospace keys, zebra striping, sticky header, key/value
search), then tightened further, then added colour-coded / dot-separated key segments
(one hue per namespace, click-to-edit display/edit split). Each step build-green.

## Key files

- `apps/run.cms/app/src/index.ts` — admin-router registration for the page endpoints
- `apps/run.cms/app/src/admin/pages/CopyCatalog.tsx` — dense colour-coded grid
- `apps/run.cms/app/src/api/ui-string/{services,controllers}/ui-string.ts` — bulk-upsert (38-01)

## Not locally verifiable (noted, not a gap)

Real S3 `copy.json` upload requires prod `S3_MEDIA_*` creds; locally the export code
path fires and no-ops cleanly. Region-prefix resolution confirmed on `/use1/…`;
multi-region behaviour is unchanged infra.
