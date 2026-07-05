---
phase: 35-cms-copy-catalog-foundation
reviewed: 2026-07-05T08:51:02Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - apps/run.cms/app/database/migrations/2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js
  - apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts
  - apps/run.cms/app/src/api/ui-string/content-types/ui-string/schema.json
  - apps/run.cms/app/src/api/ui-string/controllers/ui-string.ts
  - apps/run.cms/app/src/api/ui-string/routes/ui-string.ts
  - apps/run.cms/app/src/api/ui-string/services/copy-export.ts
  - apps/run.cms/app/src/api/ui-string/services/ui-string.ts
  - apps/run.cms/app/src/index.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: resolved
resolution:
  warnings_fixed: 2
  note: "WR-01 fixed (require full S3 credential set before export); WR-02 fixed (notes marked private, excluded from read-only API). Both verified via dist-boot harness 2026-07-05. 3 info findings reviewed as acceptable for v1."
---

# Phase 35: Code Review Report

> **Resolved 2026-07-05:** both warnings fixed and verified — WR-01 (S3 partial-credential guard) and
> WR-02 (`notes` leaked via the read-only API → now `private:true`). The 3 info findings are accepted for v1.

**Reviewed:** 2026-07-05T08:51:02Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** resolved (2 warnings fixed)

## Summary

Reviewed the new `ui-string` collection type (schema, controller, router, service),
the `(key,locale)` uniqueness lifecycle guard + backstop DB migration, the S3
`copy.json` export helper, and the public-role permission revocation in `index.ts`.

Overall the design is sound and the security-sensitive parts hold up:

- **Permission gating is correct.** `api::ui-string.ui-string.find` / `.findOne`
  are added to the public-role revocation list (`index.ts:134-135`), so anonymous
  access is disabled and content requires the internal read-only API token —
  consistent with the existing content types.
- **S3 credential handling mirrors the established convention.** `copy-export.ts`
  gates on `S3_MEDIA_BUCKET`/`S3_MEDIA_ACCESS_KEY` and uses static keys exactly as
  `config/plugins.ts` does; the SES/SSM path uses the task role. No hardcoded
  secrets; env-only.
- **No injection surface.** The S3 object key is built from `REGION_SHORT` (env,
  not user input); values are JSON-serialized, not string-interpolated into SQL or
  shell.
- **Uniqueness guard is well-reasoned** — beforeUpdate loads the current row to
  resolve the effective post-update `(key,locale)` and excludes self via `$ne`,
  with a DB unique index as backstop.

No critical/blocker defects were proven. Findings below are robustness and
consistency gaps.

## Warnings

### WR-01: S3 env guard omits `secretAccessKey` — silent export failure on partial credentials

**File:** `apps/run.cms/app/src/api/ui-string/services/copy-export.ts:28-34, 55-58`
**Issue:** The guard only checks `bucket` and `accessKeyId`:
```ts
const secretAccessKey = process.env.S3_MEDIA_SECRET_KEY;
if (!bucket || !accessKeyId) { ...return; }
...
credentials: { accessKeyId, secretAccessKey },
```
If `S3_MEDIA_ACCESS_KEY` and `S3_MEDIA_BUCKET` are set but `S3_MEDIA_SECRET_KEY`
is missing/empty, the guard passes and `S3Client` is constructed with
`secretAccessKey: undefined`. `PutObjectCommand` then fails during request signing,
which is swallowed by the `catch` (line 71-74) and only logged. The result is that
`copy.json` silently stops being regenerated on every editor save — the FALL-01
fallback bundle goes stale with no surfaced error. (`plugins.ts` shares the same
incomplete gate, so a partial-credential misconfig breaks both media uploads and
the copy export together.)
**Fix:** Include the secret in the guard so a partial-credential env is treated as
a clean no-op rather than a silent runtime failure:
```ts
if (!bucket || !accessKeyId || !secretAccessKey) {
  strapi.log.info('[copy-export] S3 env incomplete — skipping copy.json export');
  return;
}
```

### WR-02: `notes` internal field is exposed via the read-only REST API despite export sanitization

**File:** `apps/run.cms/app/src/api/ui-string/content-types/ui-string/schema.json:31-33`; `apps/run.cms/app/src/api/ui-string/services/copy-export.ts:44-52`
**Issue:** The `copy.json` export deliberately excludes `notes` ("an internal
editor hint, not public copy" — copy-export.ts:15-16, only `key → value` emitted).
But the default core controller/router (`controllers/ui-string.ts`,
`routes/ui-string.ts`) expose `find`/`findOne` returning **all** attributes,
including `notes`, to any holder of the read-only API token. This contradicts the
intent that `notes` is internal-only: the sanitization applied to the static
bundle is not applied to the live API surface, so internal editorial notes leak to
every API-token consumer (e.g. run.human) that reads the catalog.
**Fix:** Either drop `notes` from API responses via a sanitized controller
(`ctx.body` field-strip or `strapi.contentAPI.sanitize.output` with a reduced
schema / `populate` allowlist), or explicitly document that `notes` is
consumer-visible and must never hold sensitive content. If it is truly
internal-only, prefer stripping it at the controller boundary rather than relying
on consumers to ignore it.

## Info

### IN-01: Migration will fail if duplicate `(key,locale)` rows already exist

**File:** `apps/run.cms/app/database/migrations/2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js:17-19`
**Issue:** `CREATE UNIQUE INDEX IF NOT EXISTS` is idempotent against re-runs, but
if the `ui_strings` table already contains duplicate `(key,locale)` pairs at
migration time (e.g. rows created before the lifecycle guard shipped), the
`CREATE UNIQUE INDEX` throws and aborts boot. For a brand-new table this is a
non-issue, but there is no dedupe/pre-check.
**Fix:** Acceptable for a fresh table. If any environment may already hold data,
add a pre-check query for duplicates and log/resolve them before creating the
index, or wrap in a try/catch that logs actionable guidance rather than failing boot.

### IN-02: `limit: -1` relies on SQLite-specific "unlimited" semantics

**File:** `apps/run.cms/app/src/api/ui-string/services/copy-export.ts:40-43`
**Issue:** `strapi.db.query(UID).findMany({ where: {}, limit: -1 })` depends on the
query engine passing `LIMIT -1` through to SQLite, which treats a negative limit as
"no limit." This works on SQLite (the deployment target) but is undocumented at the
`db.query` layer and would silently truncate the exported catalog to a default page
size on any engine that clamps negative limits. Since a truncated `copy.json` drops
keys with no error, the failure mode is silent.
**Fix:** Omitting `limit` entirely returns all matching rows on `db.query.findMany`
and avoids the SQLite-specific dependency. If pagination-safety is a concern for
large catalogs, page explicitly. Otherwise document the SQLite assumption inline.

### IN-03: Duplicated `DEFAULT_LOCALE` constant; beforeUpdate self-exclusion assumes `where.id`

**File:** `apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts:5,37-64`; `apps/run.cms/app/src/api/ui-string/services/copy-export.ts:4`
**Issue:** (a) `const DEFAULT_LOCALE = 'default'` is declared independently in both
`lifecycles.ts` and `copy-export.ts`; drift between them would desync the
uniqueness key from the export grouping key. (b) In `beforeUpdate`, when
`event.params.where` has no `id` (a bulk/filter-based update), `current` is `null`
and the `$ne: id` self-exclusion is dropped, so a bulk update that leaves
`(key,locale)` unchanged would false-positive as a collision against its own row.
Admin single-row edits always carry `id`, so this is an edge case, not an
observed break.
**Fix:** Extract `DEFAULT_LOCALE` (and `UID`) into a shared module imported by
both files. For (b), if bulk updates are ever expected, resolve the affected
row ids first (or scope the conflict query to exclude the update's own `where`
set); otherwise document that the guard assumes id-scoped updates.

---

_Reviewed: 2026-07-05T08:51:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
