---
status: complete
phase: 35-cms-copy-catalog-foundation
source: [35-VERIFICATION.md]
started: 2026-07-05T08:57:51Z
updated: 2026-07-05T15:09:21Z
---

## Current Test

[testing complete]

## Tests

### 1. Content-manager authoring of a ui-string row (incl. the locale-Private caveat)
expected: key/value/namespace/notes editable and saveable with no publish step; the locale-default limitation resolved so rows are uniqueness-safe on every authoring path.
result: pass
finding: |
  AUTOMATED (boot from dist against a throwaway copy of the dev DB). Initial run found the locale-Private
  caveat had teeth: omitting locale persisted null. FIXED in commit 1ddf0b71 — beforeCreate/beforeUpdate now
  coalesce locale to "default" and write it back, so every create (including the default content-manager path
  where locale is a hidden Private field) stores locale="default". Post-fix: explicit- and omitted-locale
  creates both persist locale="default" with all fields; draftAndPublish:false (live, no publish step).
  Residual (cosmetic, deferred to Phase 38): locale is still a Private field so it won't render as an editable
  column in the default content-manager — but it no longer needs to, since it's always "default" in v1.

### 2. Duplicate (key, locale) create returns HTTP 400 not 500; value-only update succeeds
expected: a second create with the same key+locale returns HTTP 400 ValidationError (never 500); a value-only update to the first row succeeds (no self-collision).
result: pass
finding: |
  AUTOMATED. Duplicate (key,'default') → ValidationError → HTTP 400 (NOT 500); value-only self-update →
  succeeds; DB unique-index backstop independently rejected a raw duplicate INSERT. Post-fix this now holds
  on the omitted-locale path too: two no-locale creates of the same key → second rejected, count(key)=1
  (regression suite, all green).

### 3. read-only token access matrix against a booted Strapi
expected: GET find/findOne with Bearer token → 200; POST/PUT/DELETE with token → 403; GET with no token → 403.
result: pass
finding: |
  AUTOMATED (real HTTP via strapi.server.listen, read-only token minted in-process):
  {"token_GET_find":200,"token_GET_findOne":200,"token_POST_create":403,"token_PUT_update":403,
  "token_DELETE":403,"notoken_GET_find":403,"notoken_GET_findOne":403} — exact match to the 35-03-SUMMARY matrix.

### 4. copy.json regeneration on create/update/delete (master + S3 env); local no-op without S3
expected: master env writes copy.json with shape { "default": { "<key>": "<value>" } }, no notes; delete drops the key; local (no S3 env) save logs skip and does NOT throw.
result: pass
finding: |
  AUTOMATED (dist copy-export invoked directly; S3Client stubbed to capture the PutObject):
  local no-op returned without throwing; master export → PutObject Key="use1/cms/copy.json",
  ContentType="application/json", body {default:{…}}, `notes` EXCLUDED, full-catalog read (deletes drop keys).
  DEFERRED (low risk): the real S3 PutObject network call + CloudFront propagation need a live master + real
  S3 credentials — code path, key, body shape, and note-exclusion are all verified.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "UI strings are stored as (key, locale) rows with locale defaulting to 'default', and duplicate (key, locale) is rejected"
  status: resolved
  severity: major
  test: 1
  resolved_by: 1ddf0b71
  reason: |
    Strapi reserves `locale`, coerces it Private, and drops the schema default, so an omitted-locale create
    persisted null — silently defeating uniqueness (guard compared against 'default'; SQLite unique index treats
    NULLs as distinct). Found empirically 2026-07-05 via a dist-boot harness.
  resolution: |
    Fixed in commit 1ddf0b71: ui-string lifecycles.ts beforeCreate/beforeUpdate now coalesce locale to
    'default' and write it back into the row, so stored locale is never null on any authoring path — restoring
    both the lifecycle guard and the (non-null) DB unique index. Verified GREEN by the regression suite
    (5/5 assertions) and the full re-run (TEST1–4 all PASS).
  artifacts: [apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts]
  missing: []
