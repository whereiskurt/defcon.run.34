---
phase: 35-cms-copy-catalog-foundation
verified: 2026-07-05T08:55:48Z
status: passed
score: 1/5 must-haves fully verified (5/5 artifacts+wiring verified; 4 runtime behaviors deferred to UAT)
behavior_unverified: 4
overrides_applied: 0
behavior_unverified_items:

  - truth: "An editor can create/edit a ui-string row (key, locale, value, namespace, notes) in the Strapi default content-manager"
    test: "Boot Strapi (npm run develop in apps/run.cms/app), open admin → Content Manager → UI String → Create an entry"
    expected: "Row saves with no publish step (draftAndPublish:false). key/value/namespace/notes are editable. NOTE the caveat: `locale` is coerced to a Strapi-reserved Private field and will NOT appear as an editable column in the default content-manager, and its declared default 'default' was dropped by Strapi's schema coercion."
    why_human: "Content-manager UI rendering and field editability require a running admin panel; grep cannot observe the rendered edit form."

  - truth: "A second ui-string with the same (key, locale) is rejected with a clean 4xx (not a 500) by the lifecycle guard"
    test: "With Strapi running and a row (bib.hero.title, default) present, POST a second create with the same key+locale via the admin or an authenticated API call"
    expected: "HTTP 400 ValidationError 'A ui-string with key ... and locale ... already exists' — never a 500. A value-only update to the first row succeeds (no self-collision)."
    why_human: "The 400-vs-500 surfacing is a runtime state-transition through Strapi's lifecycle + error middleware; only a booted server exercises it. (DB-index backstop half is independently proven — see Behavioral Spot-Checks.)"

  - truth: "read-only token can find/findOne ui-string (200); writes with that token are denied (403); Public role is denied entirely (403)"
    test: "Against a booted Strapi with a read-only API token and one ui-string row: GET /api/ui-strings and /api/ui-strings/:id with Bearer token → 200; POST/PUT/DELETE with token → 403; GET with no token → 403"
    expected: "Seven-cell 200/403 matrix as recorded in 35-03-SUMMARY (token GET 200, token writes 403, no-token GET 403)"
    why_human: "Live token auth matrix requires a booted master/Strapi with the minted run-human-internal token; the SUMMARY's in-process harness was removed and its claims are not standing evidence."

  - truth: "Creating/updating/deleting any ui-string regenerates copy.json in the CMS S3 bucket (CloudFront-served), reflecting the current catalog including deletes, excluding notes"
    test: "In a master env with S3_MEDIA_* set (CMS_MODE=master), create/update/delete a ui-string, then fetch https://cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json"
    expected: "Object at ${REGION_SHORT}/cms/copy.json with shape { \"default\": { \"<key>\": \"<value>\" } }, no notes field; a delete drops the removed key. Locally (no S3 env) a save logs the skip and does NOT throw."
    why_human: "Actual S3 PutObject + CloudFront propagation requires master mode + live S3 credentials; the write path is guarded to no-op locally so it cannot be exercised here."
human_verification:

  - test: "Content-manager authoring of a ui-string row (see behavior_unverified_items #1), incl. the locale-Private caveat"
    expected: "key/value/namespace/notes editable and saveable; confirm whether the locale-Private/dropped-default limitation is acceptable for v1 or needs the Phase 38 custom grid / attribute rename"
    why_human: "Requires booted Strapi admin; also a product decision on the locale caveat"

  - test: "Duplicate (key, locale) create returns HTTP 400 not 500; value-only update succeeds"
    expected: "400 ValidationError on duplicate; 200 on self-update"
    why_human: "Runtime lifecycle + error middleware behavior needs a booted server"

  - test: "read-only token access matrix against booted Strapi (200 reads / 403 writes / 403 no-token)"
    expected: "Seven-cell matrix matches 35-03-SUMMARY"
    why_human: "Live token auth requires booted master + minted token"

  - test: "copy.json regeneration on create/update/delete in master+S3 env; local no-op without S3 env"
    expected: "copy.json at CloudFront URL reflects catalog (key→value only, no notes); delete drops key; local save does not throw"
    why_human: "Live S3 write + CloudFront requires master mode and real S3 credentials"
---

# Phase 35: CMS Copy Catalog Foundation Verification Report

**Phase Goal:** Organizers can create and edit UI strings in Strapi as `(key, locale, value)` rows with a namespace, the read-only API token exposes them for app consumers, and every change regenerates a fresh S3 fallback export.
**Verified:** 2026-07-05T08:55:48Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

Every code artifact and wiring path required by the phase goal is present, substantive, and correctly connected in the actual codebase (not just claimed in SUMMARY). No stubs, no debt markers, no missing files. The DB unique-index backstop was independently proven by executing the migration's SQL against a throwaway copy of the dev database. The remaining assertions are runtime behaviors (content-manager authoring, live duplicate-4xx, live token matrix, live S3 export) that require a booted master + S3 env and are — per the phase's own plan and this verification's scope — deferred to human UAT rather than counted as gaps.

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | Editor can create/edit a `ui-string` row (key, locale default `default`, value, namespace enum, optional notes) in Strapi | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | schema.json + CT + `ui_strings` table (all 5 cols) verified. Content-manager authoring is runtime UX → UAT. Caveat: Strapi coerced `locale` to a reserved **Private** field, dropping `Required`+`default:"default"` (generated types line: `locale: Schema.Attribute.String & Schema.Attribute.Private`). |
| 2 | A second row with same `(key, locale)` is rejected — lifecycle 4xx guard | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `lifecycles.ts` beforeCreate/beforeUpdate query `strapi.db.query` for `(key,locale)`, throw `@strapi/utils` `errors.ValidationError` (→400), self-excluded via `id: {$ne}`. Correct + wired; live 400-vs-500 needs boot. |
| 3 | ...backed by a DB unique index | ✓ VERIFIED | Migration present + **SQL proven**: applied `CREATE UNIQUE INDEX IF NOT EXISTS ui_strings_key_locale_unique ON ui_strings("key","locale")` to a DB copy → index created on (key,locale), idempotent on re-run, duplicate INSERT rejected with `UNIQUE constraint failed`, different-locale INSERT allowed. |
| 4 | read-only token can find/findOne; token writes denied; Public denied entirely | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `index.ts` `revokePublicPermissions()` extended with `api::ui-string.ui-string.find`/`.findOne` (runs all modes, not master-gated); token minted `type:'read-only'`. Code guards verified; live 200/403 matrix → UAT. |
| 5 | Create/update/delete regenerates `copy.json` in CMS S3 bucket | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `lifecycles.ts` after{Create,Update,Delete} → `regenerateAndUpload(strapi)`; `copy-export.ts` reads full catalog, builds `{locale:{key:value}}` (notes excluded), PutObject `${REGION_SHORT}/cms/copy.json`, master-only + S3-env guards, try/catch. Wired + guarded; live S3 write → UAT. |

**Score:** 1/5 truths fully verified (behavioral); 4 present + wired, runtime behavior deferred to UAT. Artifacts + wiring: 5/5 verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/api/ui-string/content-types/ui-string/schema.json` | 5-attr collectionType, `ui_strings`, draftAndPublish:false | ✓ VERIFIED | Shape assertion passes: collectionName, singular/plural, enum exactly [common,human,auth,gpx,bib,flash], locale default, no i18n plugin |
| `controllers/ui-string.ts`, `routes/ui-string.ts`, `services/ui-string.ts` | one-line core factories | ✓ VERIFIED | All three bind `api::ui-string.ui-string` |
| `content-types/ui-string/lifecycles.ts` | uniqueness guard + export triggers | ✓ VERIFIED | before/afterCreate/Update + afterDelete; correct auto-load path; imports copy-export |
| `database/migrations/2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js` | idempotent, guarded unique index | ✓ VERIFIED | IF NOT EXISTS + hasTable guard + quoted `key`; SQL behavior proven |
| `services/copy-export.ts` | master-only S3 export, notes-excluded | ✓ VERIFIED | Guards + PutObjectCommand + key→value-only bundle |
| `src/index.ts` (public deny) | ui-string find/findOne revoked | ✓ VERIFIED | Lines 134-135; token type read-only line 77 |
| `${REGION_SHORT}/cms/copy.json` S3 object | live export artifact | ⚠️ UAT | Requires master+S3 env to produce (deferred) |
| `package.json` `@aws-sdk/client-s3` | ^3.0.0, lockfile pinned | ✓ VERIFIED | `^3.0.0` aligned w/ ssm/ses siblings; lockfile pins 3.1079.0 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| schema.json `collectionName: ui_strings` | migration | table name target | ✓ WIRED | Migration + DB both reference `ui_strings` |
| lifecycles.ts | copy-export.ts | `import { regenerateAndUpload }` + after* await | ✓ WIRED | Named import + 3 call sites |
| lifecycles.ts before* | ui_strings DB | `strapi.db.query(UID).findOne` → ValidationError | ✓ WIRED | DB-layer query (bypasses Private-field REST hiding) |
| index.ts publicActions | Public role perms | revoke loop | ✓ WIRED | Both ui-string actions in list; loop disables idempotently |
| copy-export.ts | S3 | `PutObjectCommand ${REGION_SHORT}/cms/copy.json` | ✓ WIRED (code) | Live send → UAT |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Migration creates unique index, idempotent | applied migration SQL to `/tmp` DB copy, ran twice | index `ui_strings_key_locale_unique` on (key,locale), no error on re-run | ✓ PASS |
| DB rejects duplicate (key,locale) | INSERT dup after index | `UNIQUE constraint failed: ui_strings.key, ui_strings.locale` | ✓ PASS |
| DB allows different locale, same key | INSERT (key, 'fr') | inserted | ✓ PASS |
| `ui_strings` table + 5 cols exist | PRAGMA table_info on dev `.tmp/data.db` | id,document_id,key,locale,value,namespace,notes,... present | ✓ PASS |
| Live duplicate → 400 (Strapi lifecycle) | — | needs booted server | ? SKIP → UAT |
| Live token 200/403 matrix | — | needs booted master + token | ? SKIP → UAT |
| Live copy.json S3 write | — | needs master + S3 env | ? SKIP → UAT |

Note: the dev `.tmp/data.db` (booted 04:28 during Plan 01) predates Plan 02's migration (04:36), so it does NOT yet contain `ui_strings_key_locale_unique` — the index applies on the next boot. The migration SQL itself is proven correct against a copy.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| COPY-01 | 35-01 | Authorable (key,locale,value) row w/ namespace + notes | ✓ SATISFIED (code) | schema.json 5 attrs; content-manager UX → UAT |
| COPY-02 | 35-02 | (key,locale) unique — no dup rows | ✓ SATISFIED | lifecycle guard (code) + DB index (SQL proven) |
| COPY-03 | 35-03 | read-only token exposes find/findOne | ✓ SATISFIED (code) | public deny + read-only token; live matrix → UAT |
| COPY-04 | 35-01 | locale multi-lingual-ready; only `default` in v1 | ⚠️ PARTIAL | DB `locale` column accepts arbitrary strings ✓, but Strapi coerced attr to Private + dropped default — see caveat |
| FALL-01 | 35-02 | lifecycle regenerates S3 copy.json on CUD | ✓ SATISFIED (code) | after* → regenerateAndUpload; live write → UAT |

No ORPHANED requirements: all five phase IDs (COPY-01..04, FALL-01) are claimed by plans and present in REQUIREMENTS.md (all marked Complete).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | No TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER or empty-return stubs in any ui-string or migration file |

### Prohibitions (must-NOT checks)

| Prohibition | Verification | Status | Evidence |
| ----------- | ------------ | ------ | -------- |
| Duplicate (key,locale) MUST NOT succeed / MUST NOT be a 500 | judgment | ✓ code present (lifecycle 4xx + DB index proven); live surfacing → UAT | lifecycles.ts throws ValidationError; DB UNIQUE proven |
| S3 export MUST NOT run on workers; MUST NOT throw when S3 absent | judgment | ✓ VERIFIED (code) | `CMS_MODE !== 'master'` early return; missing bucket/key early return w/o throw; try/catch wrap |
| copy.json MUST NOT include `notes` or non key→value attrs | judgment | ✓ VERIFIED | copy-export bundle builds only `bundle[locale][key] = value` |
| Public role MUST NOT read ui-string | judgment | ✓ code present; live 403 → UAT | revokePublicPermissions incl. find/findOne |
| read-only token MUST NOT write; grant MUST NOT be widened | judgment | ✓ VERIFIED | token `type:'read-only'` unchanged; ensureApiTokenPublished untouched |

All prohibitions are judgment-tier (no `verification: test` declared). Code-level guards are demonstrably present; the two whose enforcement is purely runtime (live duplicate-4xx, live Public-403) are folded into the human UAT items above. None silently passed.

### Human Verification Required

Four runtime items (detailed in frontmatter `human_verification` / `behavior_unverified_items`), all requiring a booted Strapi (and, for two, master mode + live S3):

1. **Content-manager authoring** — create/edit a UI String row; confirm the **locale-Private / dropped-default caveat** is acceptable for v1 (authoring locale is planned for the Phase 38 custom grid).
2. **Duplicate → HTTP 400** (not 500); value-only self-update → 200.
3. **read-only token access matrix** — 200 reads / 403 writes / 403 no-token (per 35-03-SUMMARY).
4. **copy.json S3 regeneration** on create/update/delete (master+S3), key→value only, delete drops key; local save no-op without S3 env.

### Gaps Summary

No blocking gaps. Every file the goal requires exists, is substantive, correctly wired, and free of stubs/debt markers. The DB unique-index backstop — the one piece deterministically testable offline — was independently proven. All five requirement IDs are accounted for.

One WARNING to surface (not a blocker): Strapi reserves the `locale` attribute name and coerced it to a **Private** field, silently dropping the declared `required: true` and `default: "default"`. Consequences: (a) `locale` will not render as an editable field in the default content-manager, and (b) it is excluded from default REST responses. This is mitigated in-code — the lifecycle guard and copy-export both read `locale` via the DB layer (`strapi.db.query`) and fall back to `'default'`, and the copy.json is keyed by DB-layer locale — and the plans explicitly defer locale authoring to the Phase 38 custom admin grid. It weakens COPY-04's app-layer default guarantee and success-criterion-1's "locale (default default)" editability, so it belongs in the human decision. Both SUMMARY 35-01 and this report flag it; consider whether a Phase 38 attribute rename (e.g. `localeCode`) is warranted.

The remaining items are genuine runtime acceptance (live duplicate-4xx, live token matrix, live S3 export, content-manager authoring) that cannot be exercised without a booted master + S3 env — correctly routed to human UAT per the phase scope, not counted as gaps.

---

_Verified: 2026-07-05T08:55:48Z_
_Verifier: Claude (gsd-verifier)_
