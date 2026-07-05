---
phase: 35
plan: 01
subsystem: run.cms
tags: [strapi, content-type, ui-string, copy-catalog]
status: complete
requires: []
provides:
  - "api::ui-string.ui-string content type (collectionName ui_strings)"
  - "REST resource /api/ui-strings"
  - "ui_strings SQLite table (key, locale, value, namespace, notes)"
affects:
  - "35-02 (unique-index migration targets ui_strings table)"
  - "35-03 (permission actions gate /api/ui-strings REST path)"
  - "38 (custom admin grid reads/writes locale/value on ui-strings)"
tech_stack:
  added: []
  patterns:
    - "Core factory API (controller/router/service) mirroring api::route.route"
    - "draftAndPublish:false content type (save = live)"
key_files:
  created:
    - apps/run.cms/app/src/api/ui-string/content-types/ui-string/schema.json
    - apps/run.cms/app/src/api/ui-string/controllers/ui-string.ts
    - apps/run.cms/app/src/api/ui-string/routes/ui-string.ts
    - apps/run.cms/app/src/api/ui-string/services/ui-string.ts
  modified:
    - apps/run.cms/app/types/generated/contentTypes.d.ts
decisions:
  - "Kept attribute name `locale` per plan mandate despite Strapi reserving it (see Risks) — Plans 02/38 depend on the exact name"
metrics:
  duration: 5m
  tasks: 3
  files: 5
  completed: 2026-07-05
requirements: [COPY-01, COPY-04]
---

# Phase 35 Plan 01: ui-string Collection Content Type Summary

Created the `ui-string` Strapi 5 collection content type — the producer-side data model for the v1.9 CMS copy catalog — with a stable `ui_strings` table and `/api/ui-strings` REST resource that Plans 02/03/38 build on.

## What Was Built

- **`schema.json`** — a `collectionType` with `collectionName: "ui_strings"`, `singularName: "ui-string"`, `pluralName: "ui-strings"`, `draftAndPublish: false`, and exactly five scalar attributes:
  - `key` — string, required (dotted `<namespace>.<area>.<element>` convention, enforced by authors not schema)
  - `locale` — string, required, `default: "default"` (plain column, no i18n plugin options)
  - `value` — text (copy string; markdown/`{placeholder}` rendered downstream)
  - `namespace` — enumeration `[common, human, auth, gpx, bib, flash]`, required
  - `notes` — text, optional
- **Core factory trio** — `controllers/ui-string.ts`, `routes/ui-string.ts`, `services/ui-string.ts`, each a one-line default-export factory bound to `api::ui-string.ui-string`, mirroring the existing `route` API. No custom actions/routes/methods (lifecycles + S3 export are Plan 02).
- **Live schema** — booted Strapi 5.33.3 (dev), which applied the schema to SQLite and created the `ui_strings` table with all five columns (verified via `better-sqlite3` introspection: `key, locale, value, namespace, notes` present alongside Strapi's standard columns).

## Verification

All three automated gates passed:
- Task 1: schema shape assertion (collectionName, draftAndPublish:false, five attributes, enum, locale default, no i18n) — `schema OK`.
- Task 2: three factory files bind to `api::ui-string.ui-string` — `factories OK`.
- Task 3: `ui_strings` table + five columns exist after boot — `ui_strings table + columns OK`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored dependency tree and created missing upload folder to enable the Task 3 boot**
- **Found during:** Task 3
- **Issue:** The `run.cms/app` worktree had no `node_modules`, so Strapi could not boot to apply the schema. First boot attempt then failed because `public/uploads` did not exist (required by `@strapi/provider-upload-local`).
- **Fix:** Ran `npm ci` against the committed `package-lock.json` (restores the already-declared dependency tree — not a new named package install), then created the gitignored `public/uploads` directory.
- **Files modified:** none tracked — `node_modules/`, `public/uploads/`, and `.tmp/data.db` are all gitignored. Boot secrets were passed inline (no `.env` written).
- **Commit:** n/a (no tracked changes)

**2. [Consequence] Regenerated `contentTypes.d.ts`**
- **Found during:** Task 3
- **Issue:** Booting Strapi regenerated the tracked `types/generated/contentTypes.d.ts`, adding the `ApiUiStringUiString` interface and registering `api::ui-string.ui-string`. The regeneration also corrected pre-existing route drift (added `gpxFileId`, `stravaUrl`, `updatedAt/By` already present in `route/schema.json` but missing from the stale generated file).
- **Fix:** Committed the regenerated file to keep tracked types in sync.
- **Commit:** f71ed3e3

## Risks / Concerns for Downstream Plans

**Strapi reserves the `locale` attribute name (flag for Plan 02 / verifier / Plan 38).**
The regenerated types show Strapi coerced our `locale` attribute into its reserved internal field: `locale: Schema.Attribute.String & Schema.Attribute.Private;` with an auto-injected `localizations` relation, and it dropped the `Required` + `DefaultTo<"default">` we declared. Implications:
- `locale` is marked **Private** → it will NOT appear as a normal editable field in the default content-manager edit view, and is excluded from default REST responses. This may block this plan's *manual* verification step ("save a row with locale=default in the content-manager") and weakens COPY-04's default-value guarantee at the app layer.
- The DB column `ui_strings.locale` **does exist** (verified), so Plan 02's `(key, locale)` unique-index backstop can still target it, and Plan 38's custom admin grid can read/write it via the entity service (bypassing the content-manager's hiding of reserved fields).
- **Not renamed** because the plan explicitly mandates the field name `locale` and Plans 02 (`(key,locale)` uniqueness) and 38 (`label·locale·value` grid) depend on that exact name. Renaming is an architectural decision spanning three plans — surfaced here rather than taken unilaterally.
- **Suggested resolution for Plan 02/38:** either (a) accept the Private marking and drive locale exclusively through Plan 38's custom admin (recommended — the default content-manager is not the v1 authoring surface), or (b) if default-content-manager editing of locale is required in v1, rename the attribute (e.g. `localeCode`) across schema + Plans 02/38, or install `@strapi/plugin-i18n` (explicitly rejected by the v1.9 design). Note: `required`/`default` on `key`/`namespace` are enforced by Strapi's ORM layer, not DB constraints (all columns show `notnull=0`), which is normal Strapi behavior.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/run.cms/app/src/api/ui-string/content-types/ui-string/schema.json
- FOUND: apps/run.cms/app/src/api/ui-string/controllers/ui-string.ts
- FOUND: apps/run.cms/app/src/api/ui-string/routes/ui-string.ts
- FOUND: apps/run.cms/app/src/api/ui-string/services/ui-string.ts
- FOUND commit bcf7dc7c (Task 1 schema)
- FOUND commit 2ee5db95 (Task 2 factories)
- FOUND commit f71ed3e3 (Task 3 regenerated types)
