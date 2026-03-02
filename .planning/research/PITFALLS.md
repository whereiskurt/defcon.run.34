# Domain Pitfalls: CMS Content Types (Events, Routes, POIs)

**Domain:** Strapi 5.6 CMS with SQLite + Litestream master-worker replication
**Project:** cms.defcon.run v1.1 — Adding content types to existing deployment
**Researched:** 2026-03-02

---

## Critical Pitfalls

Mistakes that cause data loss, broken replication, or require architectural rework.

### Pitfall 1: Worker Database Swap Corrupts Active SQLite Connections

**What goes wrong:** The worker's `litestream-sync.sh` uses `mv "$TEMP_DB" "$DB_PATH"` to atomically replace the database file while Strapi is actively reading it. When SQLite is in WAL mode (which Litestream requires), the database is actually three files: `strapi.db`, `strapi.db-wal`, and `strapi.db-shm`. The `mv` replaces only the main file, leaving stale WAL and shared-memory files. Strapi's open connection now references an inode that no longer matches the WAL, causing `SQLITE_CORRUPT` errors or silently returning stale/garbled data.

**Why it happens:** The current sync script was written for a CMS with zero content types (no reads during sync). Once content types exist, run.human workers will be continuously querying the worker CMS API for events/routes/POIs. The `mv` operation races against these reads.

**Consequences:** Workers serve corrupted or inconsistent data to run.human. API requests return 500 errors or partial data. With many-to-many relations (events-to-routes), join table corruption is especially dangerous because it silently drops relations rather than failing visibly.

**Prevention:**
- Replace the `mv` swap with a restart-based sync: stop Strapi, perform `litestream restore`, restart Strapi. The worker supervisord config already has Strapi restart handling.
- Alternatively, restore to a completely separate path including WAL/SHM files, then restart Strapi pointing to the new path.
- Set `PRAGMA busy_timeout = 5000;` in Strapi's database config to handle any Litestream checkpoint lock contention.
- Add the `acquireConnectionTimeout` (already set to 60000ms) and ensure Knex pool max stays at 1 (already configured).

**Detection:** Monitor worker health endpoint after each sync cycle. Log response times and error rates. Any `SQLITE_CORRUPT` or `SQLITE_IOERR` in worker logs is this pitfall.

**Phase:** Phase 1 (infrastructure hardening) -- must fix BEFORE adding content types, because the first content type makes the sync script dangerous.

**Confidence:** HIGH -- SQLite documentation explicitly states that moving a database file while connections are open causes corruption when WAL/SHM files are not moved together. The current `litestream-sync.sh` (lines 51-58) does exactly this.

---

### Pitfall 2: Strapi Content Type Builder Overwrites Hand-Edited schema.json

**What goes wrong:** Content types are defined as `schema.json` files in `src/api/{type}/`. If anyone uses the Strapi admin Content-Type Builder UI (available to Super Admins) to add or modify a field, Strapi regenerates the entire `schema.json`, stripping custom options like `populateCreatorFields`, custom validators, or carefully ordered attributes. The generated schema may also reformat the JSON, breaking git diffs.

**Why it happens:** Strapi's Content-Type Builder is designed for development convenience and assumes it owns the schema. It does not preserve unknown keys or custom formatting. This is a confirmed bug (strapi/strapi#21753) that affects Strapi 5.0.4+ and is not yet fixed as of 5.6.

**Consequences:** Custom schema options silently lost. If the content type is deployed from git, the admin-modified version in the running database diverges from the git version. Next deployment overwrites the admin changes, or the admin changes overwrite git, depending on deploy order. Either way, content types silently change shape.

**Prevention:**
- Disable the Content-Type Builder in production entirely. Set `config.features.contentTypeBuilder = false` or use middleware to block CTB routes.
- Define all content types exclusively in code (`src/api/*/content-types/*/schema.json`). Never use the admin UI for schema changes.
- Add a CI check: validate schema.json files against a known-good snapshot. Any unexpected diff blocks deploy.
- Document for organizers: "Content types are code-managed. Request changes via GitHub issue, not admin UI."

**Detection:** Git diff on `src/api/*/content-types/*/schema.json` before every deploy. Any unexpected change is this pitfall.

**Phase:** Phase 1 (content type creation) -- establish the code-only workflow before creating any content types.

**Confidence:** HIGH -- confirmed in strapi/strapi#21753, reproducible in Strapi 5.6.

---

### Pitfall 3: Many-to-Many Relations Require Correct Bidirectional Schema or Data Silently Fails

**What goes wrong:** Strapi 5 many-to-many relations require matching `inversedBy`/`mappedBy` declarations on both sides. If side A declares `inversedBy: "events"` but side B either omits `mappedBy` or uses a different attribute name, the relation appears to work in the admin UI but:
1. The join table is created with wrong foreign key columns
2. API population returns empty arrays for one direction
3. Connect/disconnect operations via the Document Service API silently do nothing

**Why it happens:** Strapi 5 uses the `api::content-type.content-type` target format (e.g., `api::event.event`) and the `inversedBy`/`mappedBy` pair must reference the exact attribute name on the other side, not the content type name. This is a subtle distinction that causes silent failures.

**Consequences:** Events appear to have no routes. Routes appear to have no events. The admin UI may show the relation as connected (it reads the join table directly) but the REST API (which uses the Document Service) returns empty arrays because the population path is broken.

**Prevention:**
- For each many-to-many relation, define BOTH sides explicitly in schema.json:
  ```json
  // Event schema.json
  "routes": {
    "type": "relation",
    "relation": "manyToMany",
    "target": "api::route.route",
    "inversedBy": "events"
  }

  // Route schema.json
  "events": {
    "type": "relation",
    "relation": "manyToMany",
    "target": "api::event.event",
    "mappedBy": "routes"
  }
  ```
- The side with `inversedBy` owns the join table. The side with `mappedBy` is the inverse. Pick the "owner" deliberately (event owns event-route join).
- After creating content types, verify BOTH directions work via REST API: `GET /api/events?populate=routes` AND `GET /api/routes?populate=events`. Both must return populated data.
- Test with curl, not just the admin UI, because the admin UI uses a different query path.

**Detection:** API integration test that creates an event, connects a route, then queries both directions. If either returns empty, the relation is misconfigured.

**Phase:** Phase 1 (content type creation) -- relation configuration is foundational.

**Confidence:** HIGH -- Strapi 5 documentation confirms the `inversedBy`/`mappedBy` requirement. Multiple forum posts report silent failures when this is wrong (forum.strapi.io/t/cannot-populate-many-to-many-relation/20733).

---

### Pitfall 4: REST API Returns Empty Relations by Default -- run.human Gets No Data

**What goes wrong:** run.human calls the CMS worker API to fetch events with their routes and POIs. The response contains only scalar fields -- no relations, no media, no components. The developer concludes the content types are broken, but the data is there; it just is not populated.

**Why it happens:** Strapi 5 REST API does NOT populate any relations, media fields, components, or dynamic zones by default. This is a deliberate design choice for performance. Every relation must be explicitly requested via the `populate` query parameter. For nested relations (event -> routes -> pois), you need nested populate syntax: `populate[routes][populate][0]=pois`.

**Consequences:** run.human displays events with no routes, routes with no POIs, events with no photos. Developers waste hours debugging "missing data" that is actually just unpopulated.

**Prevention:**
- Create a custom controller or middleware on the CMS side that enforces default population for each content type. For example, an event always returns with routes and media populated.
- Use route-level middleware pattern (recommended by Strapi) to set default populate:
  ```js
  // src/api/event/middlewares/default-populate.js
  module.exports = (config, { strapi }) => {
    return async (ctx, next) => {
      if (!ctx.query.populate) {
        ctx.query.populate = {
          routes: { populate: ['pois'] },
          photos: true,
          attachments: true
        };
      }
      await next();
    };
  };
  ```
- Document the exact populate parameters run.human must use for each endpoint.
- Never use `populate=*` or `populate=deep` in production -- these generate expensive multi-join SQL queries that will lock SQLite for too long.
- Limit population depth to 2 levels maximum (event -> routes -> pois). Deeper nesting means the data model needs restructuring.

**Detection:** API smoke test that verifies populated fields are present in responses.

**Phase:** Phase 2 (API verification) -- after content types exist, before run.human integration.

**Confidence:** HIGH -- this is explicitly documented in Strapi 5 REST API docs (docs.strapi.io/cms/api/rest/populate-select).

---

### Pitfall 5: Media URLs Break Across Regions Due to S3 rootPath and CloudFront Mismatch

**What goes wrong:** CMS media is stored in S3 with a region-prefixed path (`use1/cms/image.png`) and served via CloudFront at `https://cms.defcon.run/use1/cms/image.png`. The master CMS in us-east-1 creates entries with media URLs containing `use1` in the path. Workers in ca-central-1 serve these same entries (via Litestream replication), but the URLs still point to `use1/cms/` paths. If run.human in ca-central-1 renders these URLs, they work (CloudFront serves from S3 regardless of region prefix in URL), BUT:
1. The media S3 bucket has cross-region replication, and there may be a brief window where newly uploaded media exists in us-east-1 S3 but not yet in ca-central-1 S3.
2. If CloudFront is configured with region-specific S3 origins, the `use1/cms/` path from ca-central-1 may route to the wrong S3 bucket.

**Why it happens:** The `rootPath` in plugins.ts is `${regionShort}/cms`, and `baseUrl` is `https://cms.defcon.run`. So Strapi stores media URLs as `https://cms.defcon.run/use1/cms/filename.ext`. Since only the master (us-east-1) writes, ALL media URLs contain `use1`. This is correct IF CloudFront routes all `/use1/cms/*` requests to the us-east-1 S3 origin regardless of which edge location serves the request.

**Consequences:** Newly uploaded images may 404 on non-master regions for a few seconds/minutes until S3 replication completes. If CloudFront origin routing is wrong, images 404 permanently in non-master regions.

**Prevention:**
- Verify that CloudFront for cms.defcon.run routes `/use1/cms/*` to the us-east-1 S3 bucket from ALL edge locations (not just use1 edges). This should already work with a single S3 origin, but verify.
- Accept that media URLs are master-region-specific. Since the master always writes to `use1/cms/`, this is consistent. Workers replicate the DB, and the URLs are absolute. This is actually fine.
- Set CloudFront cache TTL to allow S3 replication to complete (at least 60 seconds for new objects).
- Test: upload an image on the master, then immediately query it from a worker in ca-central-1. If it 404s, check S3 replication lag and CloudFront cache behavior.

**Detection:** Monitor S3 replication metrics. Test media availability from non-master regions after upload.

**Phase:** Phase 2 (media upload testing) -- after content types with media fields exist.

**Confidence:** MEDIUM -- the current CMS media setup (plugins.ts lines 17-19) hardcodes `rootPath` to `${regionShort}/cms` which is always `use1` on master. This works correctly IF CloudFront has the right origin setup. Need to verify CloudFront config.

---

## Moderate Pitfalls

Issues that cause development friction, data inconsistency, or degraded UX but are recoverable.

### Pitfall 6: GPX Files Rejected by Strapi Media Library MIME Type Validation

**What goes wrong:** Route content types need GPX file attachments. When uploading a `.gpx` file through the Strapi media library, it may be rejected because GPX files have MIME type `application/gpx+xml` or sometimes `application/xml` or `text/xml` depending on the browser. Strapi's upload security middleware validates MIME types, and `application/gpx+xml` is not in the default allowed list.

**Why it happens:** Strapi's upload plugin categorizes files into images, videos, audios, and "files." The "files" category has its own allowed MIME types. Custom XML-based formats like GPX are not recognized by default.

**Consequences:** Organizers cannot upload GPX files through the admin panel. They get a generic "file type not allowed" error with no guidance on which types are accepted.

**Prevention:**
- Configure allowed MIME types in the upload security settings to include GPX:
  ```js
  // config/plugins.ts - upload security
  sizeLimit: 100 * 1024 * 1024,
  breakpoints: {},
  // Allow GPX files (XML-based)
  ```
- Alternatively, store GPX as a `text` field on the Route content type (GPX is just XML text). This avoids MIME type issues entirely and makes the content searchable. However, large GPX files (multi-MB) may strain SQLite row size limits.
- If using media library: test with actual GPX files from multiple browsers (Chrome sends `application/gpx+xml`, Firefox may send `application/xml`).
- The middleware config already allows 100MB file size (`formidable.maxFileSize` in middlewares.ts), so size is not the issue.

**Detection:** Upload test with a real GPX file through the admin panel before declaring the content type complete.

**Phase:** Phase 1 (content type creation) -- configure upload restrictions when defining Route content type.

**Confidence:** MEDIUM -- depends on whether the current `strapi::security` middleware blocks unknown MIME types. The current config (middlewares.ts) does not explicitly restrict upload MIME types, but Strapi's default may.

---

### Pitfall 7: Litestream 5-Minute Sync Lag Creates Stale Content on Workers

**What goes wrong:** An organizer publishes a new event or updates a route on the master CMS. They check the public site (served by run.human, which reads from a CMS worker). The old content is still showing. They publish again, thinking it failed. Now there are duplicate entries or the second publish overwrites the first. Five minutes later, the correct content appears.

**Why it happens:** Workers sync via `litestream-sync.sh` every 5 minutes (`SYNC_INTERVAL=300`). Between syncs, workers serve the previous snapshot. This is by design for eventual consistency, but organizers do not know about the delay.

**Consequences:** Organizer confusion, duplicate content creation, "it's broken" support requests. If an organizer publishes time-sensitive content (e.g., "Event starting NOW"), the 5-minute delay means 300 seconds of stale data.

**Prevention:**
- Reduce sync interval to 60 seconds for content freshness. The sync is lightweight (S3 REST call + file swap). Cost is negligible.
- Display "Last synced: X minutes ago" on run.human admin or status endpoint so organizers know when workers will catch up.
- Add a "force sync" mechanism: an API endpoint on the worker that triggers an immediate litestream restore (authenticated, admin-only).
- Make the master CMS admin panel available for both reading AND writing, with workers used only for run.human API reads. Organizers always see fresh data because they use the master.
- Document the replication delay for organizers: "Changes may take up to X minutes to appear on the public site."
- Consider eventually switching to Litestream's continuous replication mode on workers (instead of periodic restore), which would reduce lag to seconds. This requires workers to run `litestream replicate` in read-only mode, which Litestream supports but adds complexity.

**Detection:** Timestamp comparison: check worker DB modification time vs. master's latest write time.

**Phase:** Phase 3 (deployment/ops) -- sync interval tuning after content types work.

**Confidence:** HIGH -- the sync interval is hardcoded in `litestream-sync.sh` line 12 (`SYNC_INTERVAL=${SYNC_INTERVAL:-300}`). This is a configuration issue, not a bug.

---

### Pitfall 8: New Content Types Not Accessible via REST API Until Permissions Configured

**What goes wrong:** Content types are created, data is entered via admin panel, but `GET /api/events` returns 403 Forbidden. The developer thinks the content type is misconfigured, but it is actually a permissions issue.

**Why it happens:** Strapi 5 makes all content types private by default. The REST API requires explicit permissions configured via Settings > Users & Permissions > Roles > Public (or Authenticated). For each content type, `find` and `findOne` must be enabled for the appropriate role. This configuration is stored in the database, not in code, so it must be set on each environment (master and, if workers need it, on workers too -- but workers are read-only, so permissions set on master replicate via Litestream).

**Consequences:** run.human cannot fetch any content. 403 errors in production that did not occur in local development (where you might have set permissions manually).

**Prevention:**
- Create a database migration script or bootstrap lifecycle hook that sets default permissions programmatically:
  ```js
  // src/bootstrap.ts or database/migrations/
  // Grant public find/findOne for event, route, poi content types
  ```
- Use Strapi's `strapi.service('plugin::users-permissions.role')` in a bootstrap script to set permissions on first run.
- Test with a fresh database (no manual permission setup) to verify the bootstrap sets correct permissions.
- Alternatively, use API tokens (configured in admin Settings) for run.human-to-CMS communication instead of public role permissions. API tokens are more explicit and easier to manage.
- Remember: permissions are in the SQLite database and replicate via Litestream to workers. Set them on master, and workers get them at next sync.

**Detection:** Integration test that fetches each content type's REST API endpoint without authentication and verifies 200 response.

**Phase:** Phase 1 (content type creation) -- permissions setup immediately after content types are defined.

**Confidence:** HIGH -- Strapi 5 docs confirm all content types are private by default (docs.strapi.io/cms/features/users-permissions).

---

### Pitfall 9: Strapi Auto-Migration Alters SQLite Schema on Startup, Breaking Worker Reads

**What goes wrong:** A new version of the CMS with updated content types is deployed to the master. Strapi's auto-migration runs on master startup, creating new tables and columns. Workers are still running the old version with the old database. When Litestream syncs the updated database to a worker still running old Strapi code, the old code encounters unexpected columns/tables and may crash or produce errors.

**Why it happens:** Strapi auto-migrates the database schema to match the content type definitions on every startup. The master gets the new schema immediately. Workers get the new database (via Litestream) but run old code until they are redeployed. During this window, schema and code are mismatched.

**Consequences:** Workers crash or return errors for 5-10 minutes (until they are also redeployed with the new code). In a multi-region deployment, this window can be longer if regions deploy sequentially.

**Prevention:**
- Deploy strategy: deploy workers FIRST (new code, old database is fine because Strapi adds new columns gracefully), then deploy master (new code triggers migration, updates database, Litestream replicates to workers that already have new code).
- Alternatively: deploy master and workers simultaneously, accepting a brief window where workers have mismatched code/schema.
- Strapi's auto-migration is additive (adds columns, adds tables). It does NOT drop columns or rename tables. So old code reading a new database should tolerate extra columns. Verify this assumption for each schema change.
- Test the upgrade path: run old Strapi code against new-schema database to verify it does not crash.

**Detection:** Health check failures on workers after master deployment. CloudWatch log monitoring for Knex/SQLite errors.

**Phase:** Phase 3 (deployment) -- deployment order strategy.

**Confidence:** MEDIUM -- Strapi's auto-migration is documented as additive, but edge cases (renamed fields, changed relation types) could cause issues. Need to test.

---

### Pitfall 10: Draft and Publish Creates Invisible Content in REST API

**What goes wrong:** An organizer creates an event in the admin panel. They fill in all fields, save, and tell participants to check run.defcon.run. The event does not appear. The organizer saved a draft, not a published entry. Strapi 5's Document Service differentiates between draft and published states, and the REST API only returns published content by default.

**Why it happens:** Strapi 5 introduces a new Draft & Publish system tied to the Document concept. Content exists in `draft` or `published` status. The REST API returns only `published` content unless `status=draft` is explicitly requested. The admin panel defaults to saving as draft.

**Consequences:** Organizers create content that is invisible to participants. Support requests about "missing events."

**Prevention:**
- Configure content types with `draftAndPublish: false` in schema.json options if draft workflow is not needed. For an event CMS with a small team of organizers, draft mode adds complexity without value.
  ```json
  "options": {
    "draftAndPublish": false
  }
  ```
- If draft mode IS desired: add prominent "Publish" button guidance in organizer documentation. Create a custom dashboard widget showing unpublished content count.
- In run.human API calls to CMS, always use the default (published-only) filter. Never request drafts.
- Test: create content, verify it appears in REST API. If it does not, check publication status.

**Detection:** Count of entries in admin panel vs. count returned by REST API. Mismatch means unpublished drafts.

**Phase:** Phase 1 (content type creation) -- decide draft/publish strategy during schema design.

**Confidence:** HIGH -- Strapi 5 docs confirm draft/publish behavior with the Document system.

---

### Pitfall 11: Admin Custom Login Redirect Breaks on Strapi Upgrade

**What goes wrong:** The existing `app.tsx` monkey-patches `window.fetch` to intercept 401 responses and redirect to SSO login (lines 126-178). A Strapi version upgrade changes the admin panel's API patterns (different endpoint paths, different error response format), and the monkey-patch silently stops intercepting 401s. Users see the raw Strapi login form instead of the SSO redirect.

**Why it happens:** The fetch interception relies on URL pattern matching (`url.includes('/admin/')`) and response status codes. Strapi's internal admin API is not a stable public interface -- it changes between minor versions. The monkey-patch was noted as fragile in the codebase concerns audit.

**Consequences:** Organizers see an unfamiliar login page with username/password fields (no SSO). They cannot log in because they have no local password (SSO-provisioned). CMS is effectively locked out until the monkey-patch is updated.

**Prevention:**
- Pin Strapi version precisely (5.6.x). Do not upgrade Strapi during this milestone.
- If upgrading: test the SSO flow end-to-end after every Strapi version change. Verify that 401 interception, logout interception, and SSO redirect all still work.
- Consider replacing the fetch monkey-patch with Strapi's official admin extension points if available in future versions.
- Add an e2e test for the SSO login flow: navigate to admin, verify redirect to auth.defcon.run, complete OIDC flow, verify admin panel loads.
- The v1.0 retrospective warns: "Test the full OIDC flow end-to-end before calling deployment complete." This applies doubly here because adding content types changes admin panel behavior.

**Detection:** Manual SSO login test after any Strapi package update. Automated e2e test if feasible.

**Phase:** Phase 2 (branded login page) -- when modifying admin customization.

**Confidence:** HIGH -- this is explicitly called out in `.planning/codebase/CONCERNS.md` as a fragile area.

---

## Minor Pitfalls

Issues that are annoying but have straightforward fixes.

### Pitfall 12: SQLite Pool Max=1 Causes Slow Concurrent Admin Panel Operations

**What goes wrong:** Two organizers are simultaneously editing content in the admin panel. Operations become noticeably slow (2-5 second delays per save) because the Knex connection pool is limited to `max: 1` (database.ts line 9).

**Why it happens:** SQLite single-writer constraint means only one write transaction at a time. With pool max=1, Knex serializes ALL queries (reads and writes) through a single connection. This is correct for write safety but unnecessarily restricts concurrent reads.

**Prevention:**
- Keep pool max=1 for the master (single writer is correct for SQLite).
- For workers (read-only), consider increasing pool max to 2-3 for better read concurrency. Workers never write, so multiple read connections are safe.
- Ensure `PRAGMA busy_timeout = 5000;` is set to handle lock contention during Litestream checkpoints.
- For the organizer-only admin panel with 2-5 concurrent users, pool max=1 is adequate. Only optimize if latency complaints arise.

**Phase:** Phase 3 (deployment optimization) -- after content types work, if performance issues arise.

**Confidence:** MEDIUM -- depends on actual concurrent usage patterns.

---

### Pitfall 13: schema.json Attribute Order Affects Admin Panel Field Display Order

**What goes wrong:** Fields appear in an unexpected order in the admin panel's content editor. The "name" field is at the bottom, "description" is at the top, and organizers are confused by the layout.

**Why it happens:** Strapi displays fields in the admin panel based on a combination of schema.json attribute order and stored layout configuration. The initial field order comes from the schema, but once someone configures the layout via the admin panel (Content-Type Builder > Configure the view), that layout is stored in the database and overrides the schema order.

**Prevention:**
- Define attributes in schema.json in the desired display order (most important fields first).
- After deploying, configure the admin panel layout once on the master (drag fields into desired positions). This layout configuration replicates to workers via Litestream.
- Do not rely solely on schema.json order for layout -- configure explicitly in admin.

**Phase:** Phase 1 (content type creation) -- order attributes deliberately during schema design.

**Confidence:** LOW -- the exact interaction between schema order and stored layout in Strapi 5.6 needs verification.

---

### Pitfall 14: Missing Mock Outputs and SOPS Secrets Block Deployment

**What goes wrong:** New content types require no infrastructure changes, but any code change requires a new Docker image version. The v1.0 retrospective documented that deployments are blocked by missing mock outputs in ECS service terragrunt, missing SOPS secret entries, and missing CI workflow entries.

**Why it happens:** The CMS service is already deployed, so these should already exist. However, if content types require new environment variables (e.g., a new S3 bucket for GPX files, a new API token), those need SOPS entries and service.hcl updates.

**Prevention:**
- Review v1.0 deployment checklist before every CMS deploy:
  1. Mock outputs in ecs-service terragrunt: already exist for run-cms
  2. SOPS secrets: already exist, only add if new secrets needed
  3. CI workflows: already include run-cms
  4. Favicon: already deployed
  5. basePath: already configured (`/${regionShort}/admin`)
- If adding new env vars: update service.hcl, add SOPS entries, run `terragrunt plan` before deploy.
- Content type additions should NOT require infrastructure changes if the schema is code-only and no new env vars are needed.

**Phase:** Phase 3 (deployment) -- pre-deployment checklist.

**Confidence:** HIGH -- v1.0 retrospective explicitly calls out these items (`.planning/RETROSPECTIVE.md` lines 24-26).

---

### Pitfall 15: documentId vs id Confusion in API Integration

**What goes wrong:** run.human stores CMS content IDs and uses them for subsequent API calls. The developer uses the `id` field from API responses, but Strapi 5's Document Service expects `documentId` for fetch/update/delete operations. API calls with numeric `id` fail or return wrong content.

**Why it happens:** Strapi 5 introduced the Document concept where `documentId` (a UUID string) is the primary identifier for API operations, replacing the numeric `id`. The numeric `id` still exists in responses but is a database-internal identifier that should not be used in API calls. This is a breaking change from Strapi 4.

**Consequences:** run.human fetches wrong content or gets 404 errors when trying to fetch specific events/routes by ID.

**Prevention:**
- In run.human, always use `documentId` (string UUID) for CMS content references, never numeric `id`.
- When caching CMS content in run.human, key by `documentId`.
- Document this explicitly in API integration docs for run.human developers.
- Test: create content, note both `id` and `documentId`, fetch by each. Only `documentId` should work for `/api/events/:documentId`.

**Phase:** Phase 2 (API verification) -- when testing run.human-to-CMS integration.

**Confidence:** HIGH -- Strapi 5 migration docs explicitly call this out as a breaking change.

---

## Deployment-Specific Warnings (from v1.0 Retrospective)

These are not new pitfalls but recurring patterns from the v1.0 retrospective that apply to v1.1.

### Pitfall 16: basePath Double-Prefix in Admin Panel Asset URLs

**What goes wrong:** Strapi admin assets load from the wrong URL path. The admin panel shows a blank white page because JS/CSS files return 404.

**Why it happens:** `server.url` and `admin.url` can create double-prefix paths if misconfigured. Currently: `server.url = https://cms.defcon.run` (no region), `admin.url = /use1/admin`. The Vite build base path also needs `/${REGION_SHORT}/admin/`. If any of these are wrong, asset paths break.

**Prevention:**
- Do not change `server.url` or `admin.url` configuration during this milestone. The current setup works.
- When building the Docker image, verify `REGION_SHORT` is passed correctly as a build arg.
- If admin assets 404 after deploy: check the Vite build output for base path, check nginx routing rules.

**Phase:** Phase 3 (deployment) -- verify after any Docker image rebuild.

**Confidence:** HIGH -- this is documented in v1.0 retrospective and server.ts comments (lines 4-8).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Content type schema design | Schema.json overwritten by CTB (#2) | Critical | Disable CTB in production, code-only workflow |
| Content type schema design | Many-to-many inversedBy/mappedBy mismatch (#3) | Critical | Both sides defined, test both API directions |
| Content type schema design | Draft/publish confusion (#10) | Moderate | Set `draftAndPublish: false` or train organizers |
| Content type schema design | Attribute order affects UI (#13) | Minor | Order deliberately, configure layout in admin |
| Media/file handling | GPX MIME type rejected (#6) | Moderate | Configure upload allowedTypes for GPX |
| Media/file handling | Media URLs cross-region (#5) | Critical | Verify CloudFront origin routing |
| REST API integration | Empty relations by default (#4) | Critical | Custom middleware for default population |
| REST API integration | Permissions not configured (#8) | Moderate | Bootstrap script for public permissions |
| REST API integration | documentId vs id (#15) | Moderate | Always use documentId in run.human |
| Master-worker replication | DB swap corrupts connections (#1) | Critical | Restart-based sync, not mv swap |
| Master-worker replication | 5-minute sync lag (#7) | Moderate | Reduce to 60 seconds, add force-sync |
| Master-worker replication | Schema migration order (#9) | Moderate | Deploy workers first, then master |
| Admin customization | SSO fetch patch breaks on upgrade (#11) | Moderate | Pin Strapi version, e2e test SSO flow |
| Deployment | Missing SOPS/mock outputs (#14) | Moderate | Pre-deployment checklist from v1.0 retro |
| Deployment | basePath double-prefix (#16) | Moderate | Do not change server.url/admin.url config |

---

## Sources

### Official Documentation (HIGH confidence)
- [Strapi 5 Models/Schema Documentation](https://docs.strapi.io/cms/backend-customization/models)
- [Strapi 5 REST API Populate & Select](https://docs.strapi.io/cms/api/rest/populate-select)
- [Strapi 5 Relations REST API](https://docs.strapi.io/cms/api/rest/relations)
- [Strapi 5 Document Service API](https://docs.strapi.io/cms/api/document-service)
- [Strapi 5 Users & Permissions](https://docs.strapi.io/cms/features/users-permissions)
- [Strapi 5 Database Configuration](https://docs.strapi.io/cms/configurations/database)
- [Strapi 5 Database Migrations](https://docs.strapi.io/cms/database-migrations)
- [Strapi 5 Admin Panel Customization](https://docs.strapi.io/cms/admin-panel-customization)
- [Strapi 5 Media Library](https://docs.strapi.io/cms/features/media-library)
- [Litestream Tips & Caveats](https://litestream.io/tips/)
- [Litestream How It Works](https://litestream.io/how-it-works/)
- [SQLite WAL Documentation](https://sqlite.org/wal.html)
- [SQLite How to Corrupt a Database](https://www.sqlite.org/howtocorrupt.html)

### GitHub Issues (MEDIUM-HIGH confidence)
- [strapi/strapi#21753: schema.json overwritten by CTB](https://github.com/strapi/strapi/issues/21753)
- [strapi/strapi#23904: SQLite database locked](https://github.com/strapi/strapi/issues/23904)
- [strapi/strapi#17625: Enable WAL mode for SQLite](https://github.com/strapi/strapi/issues/17625)
- [benbjohnson/litestream#99: Write lock during shadow WAL sync](https://github.com/benbjohnson/litestream/issues/99)
- [benbjohnson/litestream#58: Rules for Litestream-compatible apps](https://github.com/benbjohnson/litestream/issues/58)

### Community/Ecosystem (MEDIUM confidence)
- [Why populate=deep Is Not Recommended](https://support.strapi.io/articles/8544110758-why-populate-deep-plugins-are-not-recommended-in-strapi)
- [Strapi Forum: Cannot populate many-to-many relation](https://forum.strapi.io/t/cannot-populate-many-to-many-relation/20733)
- [Transitioning from Strapi 4 to Strapi 5](https://strapi.io/blog/commonly-asked-questions-transitioning-from-strapi-4-to-strapi-5)
- [Strapi 5 Flattened Response Format](https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes/new-response-format)

### Internal Project Sources (HIGH confidence)
- `.planning/RETROSPECTIVE.md` -- v1.0 deployment lessons
- `.planning/codebase/CONCERNS.md` -- CMS fragile areas audit
- `.planning/codebase/ARCHITECTURE.md` -- CMS replication flow documentation
- `apps/run.cms/app/litestream-sync.sh` -- Worker sync implementation
- `apps/run.cms/app/config/database.ts` -- SQLite pool configuration
- `apps/run.cms/app/config/plugins.ts` -- S3 upload provider config
- `apps/run.cms/app/src/admin/app.tsx` -- Admin SSO monkey-patch
- `infra/terraform/live/site/services/run.cms/service.hcl` -- CMS infrastructure definition
