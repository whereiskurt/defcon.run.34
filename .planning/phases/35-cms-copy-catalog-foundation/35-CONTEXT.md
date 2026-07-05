# Phase 35: CMS Copy Catalog Foundation - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Source:** Synthesized from approved design spec (`docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md`) scoped to Phase 35, grounded against the live `apps/run.cms/app` Strapi 5 codebase.

<domain>
## Phase Boundary

Phase 35 is the **CMS producer side only** of the v1.9 copy catalog: make organizers able to author UI strings in Strapi and expose/export them. It delivers requirements **COPY-01, COPY-02, COPY-03, COPY-04, FALL-01**.

**In scope (Phase 35):**
- A new `ui-string` Strapi collection content type with the agreed fields.
- `(key, locale)` composite-uniqueness enforcement (lifecycle/controller + a DB unique-index backstop).
- Read-only API token exposes `ui-string` find/findOne; writes via that token denied; public role denied.
- A Strapi lifecycle hook that regenerates the full-catalog `copy.json` in the CMS S3 bucket (served via CloudFront) on any `ui-string` create/update/delete — master node only.

**Explicitly OUT of scope (later phases — do NOT build here):**
- The runtime copy toolkit (`loadCopy` / `t` / `CopyProvider` / `useCopy`), Next.js Data Cache wiring, and toolkit-side fallback consumption → **Phase 36** (TOOL-01+, FALL-02/03/04).
- The custom three-column admin plugin (spreadsheet editor) → later phase. Phase 35 relies on Strapi's **default content-manager** for authoring `ui-string` rows.
- Any app copy migration (bib donate/sponsor, shared chrome, flash/human/auth/gpx) → later phases.
- The committed `copy-snapshot.json` build-time floor → Phase 36 (FALL-03).

The dividing line: Phase 35 makes the catalog **authorable, readable, and exportable**. Nothing consumes it yet.
</domain>

<decisions>
## Implementation Decisions

### Content type: `ui-string` (COPY-01, COPY-04)
- New collection type at `src/api/ui-string/content-types/ui-string/schema.json`, following the existing `route` layout (`content-types/<name>/schema.json` + `controllers/` + `routes/` + `services/`).
- Attributes:
  - `key` — `string`, **required**. Dotted namespace convention `<namespace>.<area>.<element>` (e.g. `common.header.nav.maps`, `bib.hero.title`).
  - `locale` — `string`, **required**, `default: "default"`. A **plain string column**, NOT a Strapi i18n locale — this repo does not install `@strapi/plugin-i18n` and no schema uses `pluginOptions.i18n`. Holds `default` now; multi-lingual-ready for future BCP-47 codes (`fr`, `es`). Only `default` is populated in v1 (COPY-04).
  - `value` — `text` (multiline). The copy; lightweight markdown + `{placeholder}` interpolation (rendered downstream, not here).
  - `namespace` — `enumeration [common, human, auth, gpx, bib, flash]`, **required**. Kept as an explicit field (denormalizable from `key.split('.')[0]`) for a fast admin filter and bundle segmentation.
  - `notes` — `text`, optional. "where this shows" hint for editors.
- **`draftAndPublish: false`** for `ui-string` (the spec's "no draft/publish in v1" — save = live). Note this differs from `route` which uses `draftAndPublish: true`.

### Uniqueness of `(key, locale)` (COPY-02)
- Strapi has no declarative composite-unique constraint. Enforce in a **`beforeCreate` / `beforeUpdate` lifecycle hook** at `src/api/ui-string/content-types/ui-string/lifecycles.ts` (this is the first lifecycle file in the codebase — none exist today). Reject a save whose `(key, locale)` already exists on a different row.
- Add a **DB unique index on `(key, locale)`** as a backstop via a migration in `apps/run.cms/app/database/migrations/` (directory does not exist yet — create it; establishes a new convention, no in-repo example). Strapi 5 migration convention: timestamped file exporting `async up(knex) { ... }` (e.g. `knex.schema.alterTable('ui_strings', t => t.unique(['key','locale']))`). Backend is **SQLite** (`better-sqlite3`, `useNullAsDefault: true`); the underlying table is `ui_strings`.
- **Idempotent + master-authoritative:** the migration must be safe to re-run (guard "index already exists"). Workers restore master's DB wholesale via Litestream (~5 min `SYNC_INTERVAL`), so the index effectively only needs to be created on master and arrives on workers via replication. A worker booting the migration against a soon-to-be-replaced DB must not error.
- A duplicate save must surface a clean validation error, not a 500.

### Read-only API token permission (COPY-03)
- The existing bootstrap token `run-human-internal` is minted with **`type: 'read-only'`** in `ensureApiTokenPublished()` (`src/index.ts`). Strapi read-only tokens grant find/findOne across content types dynamically, so `ui-string` reads should be covered automatically once the type exists — **the plan MUST verify this empirically** (token GET `ui-string` → 200; token POST/PUT/DELETE → 403). If read-only does not auto-cover it, extend the token grant mirroring the existing pattern.
- **Deny the Public role**: `revokePublicPermissions()` in `src/index.ts` explicitly disables `find`/`findOne` per action for a fixed `publicActions` list. Add `api::ui-string.ui-string.find` and `api::ui-string.ui-string.findOne` to that list so the catalog is token-gated like `route`/`event`/`point-of-interest`.

### S3 `copy.json` export on change (FALL-01)
- A `ui-string` lifecycle hook (`afterCreate` / `afterUpdate` / `afterDelete`, same `lifecycles.ts`) regenerates the **full** catalog and writes `copy.json` to the CMS S3 bucket, served via CloudFront at `https://cms.{SITE_DOMAIN}/…`.
- **Master node only.** Gate on `process.env.CMS_MODE === 'master'` (the same guard used for `ensureApiTokenPublished` / `seedPublicRoutes` in `src/index.ts`). Workers need no change; CloudFront serves the object globally.
- Reuse the existing S3 wiring from `config/plugins.ts`: provider `aws-s3`, env `S3_MEDIA_BUCKET` / `S3_MEDIA_ACCESS_KEY` / `S3_MEDIA_SECRET_KEY` / `S3_MEDIA_REGION`, path prefix `${REGION_SHORT}/cms`. Prefer uploading through the existing Strapi upload provider path; a direct `@aws-sdk/client-s3` `PutObject` is acceptable if cleaner (note: `@aws-sdk/client-s3` is not yet a dependency — `client-ses` and `client-ssm` are — so a direct client means adding the dep).
- Bundle shape: keyed for future per-locale resolution, e.g. `{ "default": { "<key>": "<value>" } }`; single object is fine at v1 size (namespace-segmentation only if size warrants). Only `default` is populated.
- Regeneration reads the current full catalog each time (not a diff) so the export always reflects live state, including deletes.

### Claude's Discretion
- Exact `lifecycles.ts` structure (shared upsert-guard helper vs inline), and whether the S3 export is a small service in `services/` vs inline in the hook.
- Whether the unique index is added via a raw Strapi migration file or a documented equivalent; the observable requirement is a real DB-level unique constraint on `(key, locale)`.
- Error-shape details for the uniqueness rejection (which Strapi `ValidationError` / `ApplicationError`), as long as it is a 4xx with a clear message.
- Local-dev behavior when S3 env is absent: the export should no-op gracefully (mirroring how `plugins.ts` falls back to the local upload provider) rather than throw.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source of truth
- `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md` — the approved milestone design. Phase 35 = "Data Model" + "S3 Copy Export" + "Permissions & Deployment" sections and Rollout item 1's **CMS-side** portion only (toolkit/admin/migration are later phases).

### Existing CMS patterns to mirror
- `apps/run.cms/app/src/index.ts` — `ensureApiTokenPublished()` (read-only token mint), `revokePublicPermissions()` (per-action public deny list to extend), and the `mode === 'master'` bootstrap gating.
- `apps/run.cms/app/src/api/route/content-types/route/schema.json` — content-type schema convention (attributes, enums, options).
- `apps/run.cms/app/src/api/route/{controllers,routes,services}/route.ts` — the controller/route/service file layout a new `api::ui-string` must follow.
- `apps/run.cms/app/config/plugins.ts` — S3 upload provider config (`aws-s3`, `S3_MEDIA_*` env, CloudFront `cms.{siteDomain}`, `${REGION_SHORT}/cms` root path).
- `apps/run.cms/app/config/database.ts` — SQLite (`better-sqlite3`) backend; informs how the unique-index migration must be written.
- `apps/run.cms/app/package.json` — deps (`@aws-sdk/client-ssm`, `@aws-sdk/client-ses` present; `@aws-sdk/client-s3` NOT present) and `strapi develop`/`build` scripts.

### Requirements
- `.planning/REQUIREMENTS.md` — COPY-01..04, FALL-01 exact text and phase mapping (FALL-02/03/04 are Phase 36 — do not pull them forward).
</canonical_refs>

<specifics>
## Specific Ideas

- Key convention: `<namespace>.<area>.<element>`, e.g. `bib.hero.title`, `common.header.nav.maps`, `common.profileMenu.logout`. `common.*` is the shared-chrome namespace (header/profile-menu/footer) — relevant so the enum + key examples are seeded sensibly, even though no app consumes them in Phase 35.
- Litestream/topology is unchanged: edits happen on master, workers restore via Litestream (~5 min). The S3 export + lifecycle hooks run on master; the read-only token path serves regional workers. No new sync path is introduced.
- Copy is not secret — the S3 `copy.json` is public-readable static JSON via CloudFront (same posture as media).
- A minimal proof for FALL-01: editing a `ui-string` row in the Strapi admin produces an updated `copy.json` object in the bucket / at the CloudFront URL.
</specifics>

<deferred>
## Deferred Ideas

- Runtime copy toolkit (`loadCopy`, `t`, `CopyProvider`, `useCopy`), Next.js Data Cache `revalidate: N`, and toolkit-side fallback caching → **Phase 36** (TOOL-*, FALL-02/04).
- Committed `copy-snapshot.json` offline floor → **Phase 36** (FALL-03).
- Custom three-column admin plugin (spreadsheet editor + bulk-upsert controller) → later phase; Phase 35 uses the default content-manager.
- App copy migration (bib donate/sponsor first, then shared chrome, then flash/human/auth/gpx) → later phases.
- Native Strapi i18n plugin, GraphQL, rest-cache, draft/publish for copy, structured `menu` content type → out of scope for the whole milestone (YAGNI).
</deferred>

---

*Phase: 35-cms-copy-catalog-foundation*
*Context gathered: 2026-07-05 via synthesized design-spec extraction*
