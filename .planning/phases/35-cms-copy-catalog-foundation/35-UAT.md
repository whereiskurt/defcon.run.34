---
status: testing
phase: 35-cms-copy-catalog-foundation
source: [35-VERIFICATION.md]
started: 2026-07-05T08:57:51Z
updated: 2026-07-05T09:21:05Z
---

## Current Test

number: 1
name: Content-manager authoring of a ui-string row (incl. the locale-Private caveat)
expected: |
  Runtime create/persist is automated-verified (see result). The OUTSTANDING part is a product
  decision: automated testing confirmed the locale-Private caveat has real teeth — a create that
  omits `locale` (which is what the default content-manager does, since `locale` is a hidden Private
  field with its schema default dropped) stores `locale=null`, and null-locale rows are NOT deduped
  by either the lifecycle guard or the DB unique index. Decide: accept for v1, or apply the one-line
  lifecycle coercion fix (recommended) / rename to `localeCode`.
awaiting: user decision (locale caveat)

## Tests

### 1. Content-manager authoring of a ui-string row (incl. the locale-Private caveat)
expected: key/value/namespace/notes editable and saveable with no publish step; decide whether the locale-Private / dropped-default limitation is acceptable for v1 or needs a fix / the Phase 38 grid / an attribute rename.
result: [pending]
finding: |
  AUTOMATED (boot from dist against a throwaway copy of the dev DB): creating a ui-string with an
  EXPLICIT locale persists every field correctly (key/value/namespace/notes/locale), draftAndPublish:false
  so the row is immediately live. CONFIRMED CAVEAT: a create that OMITS locale stores locale=NULL — Strapi
  reserves `locale`, coerces it to a Private attribute, and drops the schema `default:"default"`. The default
  content-manager cannot set locale (Private → hidden), so admin-authored rows land with locale=null.
  Admin-UI rendering itself was not observed headless. OUTSTANDING: product decision on the caveat (see below).

### 2. Duplicate (key, locale) create returns HTTP 400 not 500; value-only update succeeds
expected: a second create with the same key+locale returns HTTP 400 ValidationError (never 500); a value-only update to the first row succeeds (no self-collision).
result: pass
finding: |
  AUTOMATED, populated-locale path (how the app-layer and the Phase 38 grid will write): duplicate
  (key,'default') → ValidationError → HTTP 400 (NOT 500); value-only self-update → succeeds; DB unique-index
  backstop independently rejected a raw duplicate INSERT with "UNIQUE constraint failed". This is the
  specified behavior and it holds.
  HOLE (same root cause as Test 1's caveat, cross-referenced to the Gaps decision): rows created WITHOUT a
  locale persist as null, and null-locale duplicates are NOT deduped — the guard queries locale='default'
  while the row stored null, and SQLite treats NULLs as distinct in the unique index. Reproduced: two
  no-locale creates of the same key → count(key)=2. Uniqueness is enforced ONLY when locale is populated.

### 3. read-only token access matrix against a booted Strapi
expected: GET find/findOne with Bearer token → 200; POST/PUT/DELETE with token → 403; GET with no token → 403.
result: pass
finding: |
  AUTOMATED (real HTTP via strapi.server.listen against the throwaway DB, read-only token minted in-process):
  {"token_GET_find":200,"token_GET_findOne":200,"token_POST_create":403,"token_PUT_update":403,
  "token_DELETE":403,"notoken_GET_find":403,"notoken_GET_findOne":403} — exact seven-cell match to the
  35-03-SUMMARY matrix. Public role denied, read-only token auto-covers find/findOne, writes denied.

### 4. copy.json regeneration on create/update/delete (master + S3 env); local no-op without S3
expected: master env writes copy.json with shape { "default": { "<key>": "<value>" } }, no notes; delete drops the key; local (no S3 env) save logs skip and does NOT throw.
result: pass
finding: |
  AUTOMATED (dist copy-export invoked directly; S3Client stubbed to capture the PutObject):
  - Local no-op: with CMS_MODE unset / no S3 env, regenerateAndUpload() returned without throwing.
  - Master export: PutObject Key="use1/cms/copy.json", ContentType="application/json", body top-level={default},
    values all strings, `notes` EXCLUDED from the bundle. Reads the FULL catalog each call, so a delete naturally
    drops the key.
  DEFERRED (cannot be exercised here): the real S3 PutObject network call + CloudFront propagation need a live
  master + real S3 credentials. Low risk — the code path, key, body shape, and note-exclusion are all verified.

## Summary

total: 4
passed: 3
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- truth: "UI strings are stored as (key, locale) rows with locale defaulting to 'default', and duplicate (key, locale) is rejected"
  status: open-decision
  severity: major
  test: 1
  reason: |
    Strapi reserves the attribute name `locale`: it coerces the field to Private and drops the schema
    `default:"default"`. A create that omits locale (the default content-manager's only option, since Private
    hides the field) stores locale=NULL. Consequences on the NULL-locale path: (a) the lifecycle uniqueness
    guard compares against 'default' and never matches null, and (b) the DB unique index on (key, locale) does
    not fire because SQLite treats NULLs as distinct — so duplicate keys can be created via the admin UI in v1.
    Uniqueness and COPY-04's default-locale guarantee hold only when locale is explicitly populated (app-layer /
    Phase 38 grid). Verified empirically 2026-07-05 via a dist-boot harness against a throwaway DB.
  recommended_fix: |
    Minimal (recommended, Phase-35 gap): in ui-string lifecycles.ts beforeCreate/beforeUpdate, WRITE the
    coalesced default back into the row so it always persists — `event.params.data.locale = data.locale ?? 'default'`
    (create) and ensure update preserves a non-null locale. This makes stored locale never-null, restoring BOTH the
    lifecycle guard and the (non-null) DB unique index regardless of authoring path. Optional longer-term: rename
    the attribute to `localeCode` to escape Strapi's reserved name (touches plans that reference `locale`).
  artifacts: [apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts, apps/run.cms/app/src/api/ui-string/content-types/ui-string/schema.json]
  missing: []
