---
phase: 35
plan: 02
subsystem: run.cms
tags: [strapi, lifecycle, migration, s3-export, ui-string, copy-catalog]
status: complete
requires:
  - "35-01 (api::ui-string.ui-string content type + ui_strings table)"
provides:
  - "(key, locale) uniqueness guard (lifecycle 4xx ValidationError)"
  - "ui_strings_key_locale_unique DB index (idempotent, Litestream-safe migration)"
  - "copy.json S3 fallback export regenerated on every ui-string create/update/delete"
  - "regenerateAndUpload(strapi) service (master-only, S3-env-guarded)"
affects:
  - "36 (copy toolkit consumes the copy.json fallback default produced here)"
  - "38 (custom admin grid writes ui-strings — its saves trigger these lifecycle hooks)"
tech_stack:
  added:
    - "@aws-sdk/client-s3 ^3.0.0 (approved via blocking-human legitimacy checkpoint)"
  patterns:
    - "First content-type lifecycle file in the repo (before*/after* hooks)"
    - "First database/migrations/*.js file (idempotent CREATE UNIQUE INDEX IF NOT EXISTS)"
    - "Direct AWS SDK v3 client usage mirroring index.ts SSMClient idiom"
    - "master-only + env-present guards mirroring plugins.ts local-fallback"
key_files:
  created:
    - apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts
    - apps/run.cms/app/database/migrations/2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js
    - apps/run.cms/app/src/api/ui-string/services/copy-export.ts
  modified:
    - apps/run.cms/app/package.json
    - apps/run.cms/app/package-lock.json
decisions:
  - "Normalized @aws-sdk/client-s3 range to ^3.0.0 to match sibling @aws-sdk deps (npm auto-resolved to ^3.1079.0); lockfile pins 3.1079.0 which satisfies the range"
  - "Grouped export bundle by row.locale ({ locale: { key: value } }) so future locales flow through; only `default` populated in v1"
  - "beforeUpdate loads the current row and merges partial data so a value-only edit is still checked against the effective (key, locale)"
metrics:
  duration: 8m
  tasks: 3
  files: 5
  completed: 2026-07-05
requirements: [COPY-02, FALL-01]
---

# Phase 35 Plan 02: (key, locale) Uniqueness + S3 copy.json Export Summary

Enforced `(key, locale)` composite uniqueness for `ui-string` (lifecycle 4xx guard + idempotent DB unique-index backstop) and wired a master-only S3 `copy.json` fallback export that regenerates the full catalog on every create/update/delete. Adds the repo's first content-type lifecycle file, first DB migration, and a small AWS SDK v3 S3 export helper.

## What Was Built

- **`lifecycles.ts`** (Task 1 + Task 3) — the repo's first content-type lifecycle file:
  - `beforeCreate` / `beforeUpdate` — uniqueness guard. Reads `key`/`locale` from `event.params.data` (missing locale → `"default"`). `beforeUpdate` loads the current row via `event.params.where.id` and merges partial data over it, then queries for a same-`(key, locale)` row excluding self (`id: { $ne }`). A collision throws `@strapi/utils` `errors.ValidationError` → surfaces as a 400, never a raw SQLite-constraint 500. A row never collides with itself, so a value-only edit passes.
  - `afterCreate` / `afterUpdate` / `afterDelete` — each awaits `regenerateAndUpload(strapi)`. Because the helper reads the full catalog, `afterDelete` correctly drops removed keys from `copy.json`.
- **Migration `2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js`** (Task 2) — repo's first `database/migrations/*.js`. CommonJS `up(knex)` runs `CREATE UNIQUE INDEX IF NOT EXISTS ui_strings_key_locale_unique ON ui_strings ("key", "locale")` (`key` quoted — SQLite reserved word). Guarded by `await knex.schema.hasTable('ui_strings')` returning early, so a worker booting against a not-yet-Litestream-replicated DB is a safe no-op. Includes a `down` that drops the index.
- **`copy-export.ts`** (Task 3) — `regenerateAndUpload(strapi)`:
  - Guard 1 (master-only): returns if `process.env.CMS_MODE !== 'master'` (workers never write).
  - Guard 2 (S3-env, local no-op): returns without throwing if `S3_MEDIA_BUCKET` or `S3_MEDIA_ACCESS_KEY` is absent (mirrors the plugins.ts local-provider fallback).
  - Reads the full catalog (`findMany({ where: {}, limit: -1 })`), builds `{ [locale]: { [key]: value } }` including ONLY `key` → `value` (no `notes` or other attributes), and `PutObjectCommand`s it to `${REGION_SHORT}/cms/copy.json` (default `use1`) — the same path scheme plugins.ts uses for media, served at `https://cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json`. No public-read ACL (bucket policy handles access). The upload is wrapped in try/catch so a failed export never breaks the editor's save.
- **`package.json` / `package-lock.json`** — added `@aws-sdk/client-s3` (approved via the Task 0 blocking-human legitimacy checkpoint), aligned to the sibling `@aws-sdk/client-ssm` / `@aws-sdk/client-ses` `^3.0.0` major.

## Verification

All three automated gates passed:
- Task 1: `beforeCreate` + `beforeUpdate` + `ValidationError` present — `uniqueness hooks present`.
- Task 2: migration has `IF NOT EXISTS` + `ui_strings` + `hasTable` — `migration idempotent+guarded`.
- Task 3: `client-s3` dep present, `CMS_MODE` + `PutObjectCommand` + `copy.json` in helper, `afterCreate`/`afterUpdate`/`afterDelete` in lifecycles — `export helper + triggers wired`.

Additional confirmations:
- `@aws-sdk/client-s3` resolves at runtime: `require('@aws-sdk/client-s3')` returns `S3Client` and `PutObjectCommand` (both functions).
- `package-lock.json` pins `@aws-sdk/client-s3@3.1079.0`, satisfying the `^3.0.0` range.

Runtime acceptance criteria (duplicate → 4xx, self-update → 200, PRAGMA index_list shows the unique index, end-to-end copy.json refresh at the CloudFront URL) require a booted Strapi with a live DB / master + S3 env and are deferred to phase-level UAT — the code paths and guards are in place per the automated gates.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Normalized the @aws-sdk/client-s3 version range**
- **Found during:** Task 3
- **Issue:** `npm install @aws-sdk/client-s3@^3.0.0` rewrote the dependency to `^3.1079.0` (npm pins to the resolved latest), diverging from the sibling `@aws-sdk/client-ssm` / `@aws-sdk/client-ses` which use `^3.0.0`. The checkpoint approved `^3.0.0`.
- **Fix:** Edited `package.json` back to `^3.0.0`. The lockfile still pins the exact resolved `3.1079.0`, which satisfies `^3.0.0`, so there is no install inconsistency — only the range declaration is aligned with its siblings and the approved value.
- **Files modified:** apps/run.cms/app/package.json
- **Commit:** f2c20c16

The Task 0 package-legitimacy checkpoint was approved by the user ("approved") before any install ran, per the blocking-human gate. No other deviations — plan executed as written.

## Prior-Wave Risk Carried Forward

Plan 35-01 flagged that Strapi 5 reserves the `locale` attribute name (types mark it `Private`), but confirmed the `ui_strings.locale` DB column exists. This plan targets that column directly at both layers:
- The lifecycle guard queries `locale` via `strapi.db.query(...)` (the entity/db layer, not the content-manager view), so the Private marking does not affect the uniqueness check.
- The migration indexes the physical `ui_strings("key", "locale")` columns, unaffected by the type-level Private marking.

No new action required; the risk does not block this plan's data-layer work. Default-content-manager editing of `locale` remains the Phase 38 concern noted in 35-01.

## Known Stubs

None.

## Threat Flags

None — no security surface beyond the plan's threat register (public copy.json excludes `notes`; S3 write is master-gated and reuses existing `S3_MEDIA_*` least-privilege creds; the new dependency passed the blocking-human legitimacy checkpoint).

## Self-Check: PASSED

- FOUND: apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts
- FOUND: apps/run.cms/app/database/migrations/2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js
- FOUND: apps/run.cms/app/src/api/ui-string/services/copy-export.ts
- FOUND commit 54b6a2bc (Task 1 uniqueness lifecycle)
- FOUND commit c99323be (Task 2 unique-index migration)
- FOUND commit f2c20c16 (Task 3 S3 export helper + triggers)
