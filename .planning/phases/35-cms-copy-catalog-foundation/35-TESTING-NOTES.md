# Phase 35 — Automated UAT Testing Notes

**When:** 2026-07-05 (automated run while the operator was away)
**How:** Booted the compiled Strapi `dist` build programmatically (`createStrapi({ distDir: 'dist' }).load()`, node v22) against a **throwaway copy** of the dev SQLite DB (`.tmp/data.db` → job tmp). No tracked files were modified; `dist` and `.tmp` are gitignored. `dist` was rebuilt first (`npm run build`) because the pre-existing build predated Plan 35-02 and lacked `lifecycles.js` / `copy-export.js`.

The migration `2026.07.05T08.00.00.000Z-ui-strings-key-locale-unique.js` applied cleanly on boot (index `ui_strings_key_locale_unique` created).

## Results

> **Update 2026-07-05:** the locale-default hole below was **fixed** in commit `1ddf0b71` (lifecycles now
> coalesce `locale` to `'default'` and persist it). Post-fix regression suite is 5/5 GREEN and the full harness
> re-run is TEST1–4 all PASS. All four UAT items now pass; the phase is complete.

| # | UAT item | Result | Evidence |
|---|----------|--------|----------|
| 1 | Content-manager authoring + locale caveat | ✅ pass (fixed) | Explicit-locale create persists all fields; `draftAndPublish:false`. Omitting locale previously stored null — **fixed in `1ddf0b71`**, now stores `'default'` on every path. |
| 2 | Duplicate (key,locale) → 400 not 500; self-update 200 | ✅ pass (+ hole) | Duplicate `(key,'default')` → `ValidationError`→HTTP 400; value-only self-update → 200; DB unique-index rejected a raw dup ("UNIQUE constraint failed"). **Hole:** null-locale rows are not deduped (guard queries 'default', index treats NULLs as distinct) — reproduced count(key)=2. |
| 3 | read-only token access matrix | ✅ pass | `{token_GET_find:200, token_GET_findOne:200, token_POST:403, token_PUT:403, token_DELETE:403, notoken_GET_find:403, notoken_GET_findOne:403}` — exact match to 35-03-SUMMARY. |
| 4 | copy.json export (master) + local no-op | ✅ pass (live S3 deferred) | Local no-op: no throw without S3 env. Master (S3Client stubbed): PutObject `Key=use1/cms/copy.json`, `ContentType=application/json`, body `{default:{…}}`, **notes excluded**, full-catalog read (deletes drop keys). Real S3 wire + CloudFront still need a live master+S3 env. |

## The one real finding — `locale` reserved-name → uniqueness hole

Root cause: Strapi 5 reserves the attribute name `locale`. It marks the field **Private** and **drops the schema `default:"default"`**. So:

- A create that **omits** `locale` (the default content-manager's only option — Private hides the field) persists `locale = NULL`.
- The lifecycle guard checks `where:{ key, locale: data.locale ?? 'default' }` → never matches a stored NULL.
- The DB unique index on `(key, locale)` doesn't fire for NULLs (SQLite: NULLs are distinct).
- Net: **duplicate keys can be created through the admin UI in v1.** Uniqueness (Success Criterion #2) and COPY-04's default-locale guarantee hold **only when `locale` is explicitly populated** (app-layer / Phase 38 grid path — both verified passing).

Also note the copy-export coalesces `row.locale || 'default'`, so the S3 bundle still buckets null-locale rows under `default` — the export is unaffected; only uniqueness/default-value is.

### Recommended fix (Phase-35 gap, minimal)
In `ui-string/content-types/ui-string/lifecycles.ts`, persist the coalesced default instead of only using it for the query:
```ts
async beforeCreate(event) {
  const { data } = event.params;
  if (!data.key) return;
  data.locale = data.locale ?? DEFAULT_LOCALE;   // write it back so it never stores null
  const existing = await strapi.db.query(UID).findOne({ where: { key: data.key, locale: data.locale } });
  if (existing) throw new errors.ValidationError(`A ui-string with key "${data.key}" and locale "${data.locale}" already exists`);
}
// beforeUpdate: likewise ensure the effective locale is written non-null when key/locale change.
```
This makes stored `locale` never-null on every authoring path, restoring both the guard and the (non-null) DB unique index. Longer-term alternative: rename the attribute to `localeCode` to escape Strapi's reserved name (touches the plans that reference `locale`).

## Also worth noting (from the earlier code review, `35-REVIEW.md`)
- **WR-01:** `copy-export.ts` S3 guard checks `bucket`/`accessKeyId` but not `secretAccessKey` — a partial-cred env would build a client with `secretAccessKey: undefined`, fail signing, and silently swallow it (stale copy.json). Not exercised above.
- **WR-02:** the live API still exposes `notes` (the static export strips it) to read-only-token consumers.

## Reproduce
Harness scripts live under the job tmp dir (`uat-final.cjs`, `probe.cjs`). To re-run: rebuild `dist`, copy `.tmp/data.db` to a scratch path, then `APP_DIR=$(pwd) UAT_DB=<scratch.db> node uat-final.cjs` from `apps/run.cms/app`.
