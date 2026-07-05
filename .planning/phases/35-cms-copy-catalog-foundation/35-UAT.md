---
status: testing
phase: 35-cms-copy-catalog-foundation
source: [35-VERIFICATION.md]
started: 2026-07-05T08:57:51Z
updated: 2026-07-05T08:57:51Z
---

## Current Test

number: 1
name: Content-manager authoring of a ui-string row (incl. the locale-Private caveat)
expected: |
  Boot Strapi (`npm run develop` in apps/run.cms/app), open admin → Content Manager → UI String → Create an entry.
  key/value/namespace/notes are editable and the row saves with no publish step (draftAndPublish:false).
  NOTE the caveat: `locale` is coerced to a Strapi-reserved Private field and will NOT appear as an editable
  column in the default content-manager, and its declared default 'default' was dropped by Strapi's coercion.
  Confirm whether that limitation is acceptable for v1 or needs the Phase 38 custom grid / an attribute rename.
awaiting: user response

## Tests

### 1. Content-manager authoring of a ui-string row (incl. the locale-Private caveat)
expected: key/value/namespace/notes editable and saveable with no publish step; confirm whether the locale-Private / dropped-default limitation is acceptable for v1 or needs the Phase 38 custom grid / attribute rename.
result: [pending]

### 2. Duplicate (key, locale) create returns HTTP 400 not 500; value-only update succeeds
expected: With a row (e.g. bib.hero.title, default) present, a second create with the same key+locale returns HTTP 400 ValidationError ("A ui-string with key ... and locale ... already exists") — never a 500. A value-only update to the first row succeeds (no self-collision).
result: [pending]

### 3. read-only token access matrix against a booted Strapi
expected: Against a booted Strapi with a read-only API token and one ui-string row — GET /api/ui-strings and /api/ui-strings/:id with Bearer token → 200; POST/PUT/DELETE with token → 403; GET with no token → 403 (seven-cell matrix matching 35-03-SUMMARY).
result: [pending]

### 4. copy.json regeneration on create/update/delete (master + S3 env); local no-op without S3
expected: In a master env with S3_MEDIA_* set (CMS_MODE=master), create/update/delete a ui-string, then fetch https://cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json — object shape { "default": { "<key>": "<value>" } }, no notes field, a delete drops the removed key. Locally (no S3 env) a save logs the skip and does NOT throw.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
