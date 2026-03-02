# Project Research Summary

**Project:** DCR34 CMS Content Types (cms.defcon.run) — v1.1
**Domain:** Headless CMS extension — event/route/POI content management on Strapi 5.6 master-worker architecture
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

This milestone adds three content types (Event, Route, Point of Interest) to an already-deployed Strapi 5.6 CMS running on ECS Fargate with SQLite + Litestream master-worker replication. The work is almost entirely additive: `schema.json` files define the data model, Strapi auto-generates REST API endpoints and admin UI, and the existing S3/CloudFront media pipeline requires only an upload provider upgrade (v4 to v5 config format). No infrastructure changes are needed. The recommended approach is schema-driven, code-only content type definition with a shared `coordinates` component, many-to-many relations between all three types, and public REST API permissions bootstrapped programmatically to avoid the manual-step problem in multi-environment deployments.

The architecture divides cleanly into write and read paths. The master (us-east-1) handles all writes from organizers through the admin panel; workers in all regions serve the REST API to run.human via internal service discovery. Relations, junction tables, and media URLs all replicate via Litestream to workers within minutes. run.human should use explicit nested population (`qs`-built queries) rather than `populate=*`, and must always reference content by `documentId` (Strapi 5's UUID string identifier), not the legacy numeric `id`.

The most critical risk is the existing `litestream-sync.sh` worker sync mechanism, which uses a bare `mv` to swap the SQLite database file while Strapi has live connections open. With zero content types this was harmless; with active REST API queries from run.human it will cause WAL/SHM file corruption and data loss. This must be fixed before any content types are deployed. The second critical risk is the `inversedBy`/`mappedBy` bidirectionality requirement on many-to-many relations — a silently wrong configuration returns empty arrays from the REST API without errors. Both risks have straightforward mitigations documented in PITFALLS.md.

## Key Findings

### Recommended Stack

The v1.1 scope requires exactly one new dependency: upgrade `@strapi/provider-upload-aws-s3` from v4 to v5 (config format changed; the v4 flat format works today via backwards compatibility but will break on provider updates). Everything else — content types, relations, media handling, enumerations, draft/publish, REST API, admin branding — is built into Strapi 5.6 with no additional packages.

**Core technologies:**
- `schema.json` files in `src/api/*/content-types/*/`: content type definition — Strapi auto-generates all REST endpoints, admin UI, and SQLite tables from these files; hand-write, never use Content-Type Builder UI in production
- `@strapi/provider-upload-aws-s3` v5: media uploads to S3 — must upgrade from v4 for stable `s3Options.credentials` config format; already configured and working, just needs version bump + config refactor
- Strapi 5 factory pattern (`createCoreController`, `createCoreService`, `createCoreRouter`): one-liner controller/service/routes boilerplate — zero custom logic needed for basic CRUD
- `shared.coordinates` Strapi component: reusable lat/lng type — used by Event (location), Route (start/end points), and POI (coordinates); create once, reference everywhere
- `qs` library (already in run.human): query builder for populate parameters — avoids manual URL encoding of nested population objects

**What NOT to add:** PostGIS/SpatiaLite (< 100 POIs, SQLite has no spatial indexing), GraphQL plugin (REST with populate is sufficient), `strapi-plugin-slugify` (built-in `uid` type handles slugs), Strapi Cloud plugin (self-hosted), custom GPX parser plugin (CMS stores as opaque files; gpx-studio in run.gpx handles parsing).

### Expected Features

**Must have (v1.1 table stakes):**
- `shared.coordinates` component — foundation for all geo fields; build this before any content type
- Event content type: title, slug, description (rich text blocks), short description, start/end datetime, location name, location (coordinates component), cover image, photo gallery, attachments, routes relation, sort order
- Route content type: name, slug, description, short description, route type enum, distance (meters), elevation gain, difficulty, estimated duration, GPX files (media/files), start/end points (coordinates), cover image, events relation, POI relation, sort order
- POI content type: name, slug, description, coordinates (required), POI type enum, marker image, photo, routes relation, sort order
- File attachments on events — downloadable GPX bundles, PDF maps, waivers
- REST API public permissions — `find` and `findOne` for Public role on all three content types
- Branded OIDC login — DCR34 logo and theme in admin panel; nginx redirect from login page directly to OIDC endpoint

**Should have (v1.1 if time permits):**
- Webhook for content changes — cache invalidation in run.human on Next.js ISR revalidation
- Documented `qs`-based populate patterns for run.human — tested query shapes for event list, event detail, route detail, all POIs map view

**Defer to v1.2+:**
- GPX file metadata extraction (distance/elevation auto-derived from uploaded GPX) — requires custom Strapi lifecycle hook
- Route preview map in admin — requires custom Strapi field plugin with Leaflet/Mapbox
- Multilingual content (i18n plugin) — likely never; DEF CON is English-primary

**Confirmed anti-features (do not build):**
Live timing, participant registration in CMS, real-time participant tracking, route editing in CMS admin, automatic geocoding, i18n, GraphQL API, complex RBAC per content type, SEO meta fields, comments/social features, recurring event scheduling.

### Architecture Approach

The implementation is additive to a working master-worker architecture. Content types are baked into the Docker image at build time (same image for master and all workers — schema consistency guaranteed). The write path runs exclusively through the master in us-east-1; the read path runs through regional workers via AWS Cloud Map service discovery (`http://run-cms-worker.app-{region}-{site}.local:1337`). All data — content fields, junction tables, media URLs — lives in one SQLite file that Litestream continuously replicates to S3, from which workers restore every 5 minutes. Media binaries go to S3 via the upload provider; only the CloudFront URL is stored in SQLite.

**Major components:**
1. **Content type schemas** (`src/api/*/content-types/*/schema.json`) — new files defining Event, Route, POI data models with one-liner factory controller/service/routes boilerplate
2. **Shared coordinates component** (`src/components/shared/coordinates.json`) — reusable lat/lng component created before any content type that references it
3. **S3 upload provider upgrade** (`package.json` + `config/plugins.ts`) — migrate from v4 flat format to v5 `s3Options` nesting; prerequisite for media upload testing
4. **Admin branding** (`src/admin/app.ts` + SVG files) — DCR34 logo and color theme; nginx login redirect to OIDC bypasses the Strapi login form entirely
5. **CMS client in run.human** (`apps/run.human/webapp/src/lib/cms-client.ts`) — service discovery fetch wrapper following `quota-client.ts` pattern; TypeScript interfaces for CMS response shapes
6. **REST API permissions bootstrap** — Public role `find`/`findOne` configured via Strapi bootstrap script (not manual admin UI), so permissions replicate via Litestream to workers

**Relation topology:** `Event <--manyToMany--> Route <--manyToMany--> POI`. Event owns the Event-Route join (has `inversedBy: "events"` on Event.routes). Route owns the Route-POI join (has `inversedBy: "routes"` on Route.pois). Both inverse sides (`mappedBy`) must be defined in their respective schemas or population silently returns empty arrays.

**Key patterns to follow:**
- Explicit population only (never `populate=*` in production — one level deep, returns internal metadata, does not traverse nested relations)
- Service discovery for internal calls (not CloudFront/ALB — lower latency, stays in VPC)
- `draftAndPublish: true` on all content types (or `false` if organizer training is a concern — decide before schema creation)
- `documentId` (UUID string) for all content references in run.human, never numeric `id` (Strapi 5 breaking change)
- Workers are functionally read-only (no ALB, DB overwritten by Litestream every 5 min, no OIDC credentials)

**Anti-patterns to avoid:**
- Writing to workers (DB overwritten on next sync cycle)
- run.human calling master instead of workers (single point, cross-region latency)
- Client-side CMS API calls from browser (exposes internal URLs, requires CORS, breaks caching)
- Local media storage (ephemeral ECS filesystem, workers cannot access master's files)

### Critical Pitfalls

1. **Worker DB swap corrupts open SQLite connections** — `litestream-sync.sh` uses `mv` to replace the DB file while Strapi has active connections in WAL mode; this leaves stale WAL/SHM files causing `SQLITE_CORRUPT`. Fix: replace `mv` swap with restart-based sync (stop Strapi, litestream restore, restart). Must fix BEFORE any content types go live with read traffic from run.human.

2. **Many-to-many `inversedBy`/`mappedBy` mismatch causes silent empty arrays** — if either side of a bidirectional relation is missing or uses the wrong attribute name, the REST API returns `[]` for populated relations without any error message. Fix: define both sides explicitly in both schemas; verify BOTH directions with curl after creation (not just admin UI, which uses a different query path).

3. **REST API returns nothing by default** — Strapi 5 never auto-populates relations, media, or components. Every field must be explicitly requested. Fix: use `qs`-built explicit populate queries; consider route-level middleware on CMS side for default population shapes; document exact query patterns for run.human developers.

4. **Content-Type Builder UI overwrites hand-edited schema.json** — Super Admins using the CTB UI regenerate the entire schema, stripping custom options and breaking git. This is a confirmed Strapi 5 bug (issue #21753). Fix: disable CTB in production via config; enforce code-only workflow; add CI check on schema files.

5. **Media URLs may break cross-region if CloudFront origin routing is wrong** — master always writes to `use1/cms/` paths; workers in ca-central-1 serve these same URLs. If CloudFront routes `/use1/cms/*` to the wrong S3 origin from non-use1 edges, images 404. Fix: verify CloudFront config before media upload testing; test image availability from ca-central-1 immediately after upload on master.

## Implications for Roadmap

Based on research, the natural build order has five phases driven by dependency constraints and the critical requirement that the worker sync script must be fixed before any content type read traffic begins.

### Phase 1: Infrastructure Hardening + Content Type Schemas
**Rationale:** The worker `litestream-sync.sh` mv-swap bug is a blocking prerequisite — creating content types without fixing it means the first time run.human reads from a worker during a sync cycle, data corruption occurs. This phase pairs the fix with content type schema creation (both are backend/CMS work with zero frontend dependencies). The S3 provider upgrade goes here because it must be in the Docker image built for media testing in Phase 2.
**Delivers:** Fixed worker sync mechanism (restart-based, not mv-swap); Event, Route, POI schemas committed to git with factory boilerplate; `shared.coordinates` component; S3 upload provider upgraded to v5; REST API endpoints responding (empty data); Content-Type Builder disabled in production
**Addresses:** Event/Route/POI table stakes fields, shared.coordinates component, file attachments on events
**Avoids:** Worker DB corruption (Pitfall 1), CTB schema overwrite (Pitfall 2), S3 upload provider future breakage

### Phase 2: Relations, Media, and API Verification
**Rationale:** With schemas defined, verify that the many-to-many relations actually work bidirectionally via the REST API before run.human integration is built on top of them. This is a testing/validation phase that catches the silent empty-array failure mode at the source. Media upload testing validates the S3 provider upgrade and CloudFront cross-region URL serving.
**Delivers:** Test content (events with routes with POIs) created via admin panel; bidirectional relation population verified via curl in both directions; media uploads (photos, GPX files) working and serving via CloudFront; Litestream replication verified with worker in ca-central-1
**Addresses:** Many-to-many relations, GPX file handling, cross-region media availability
**Avoids:** Silent relation misconfiguration (Pitfall 3), `populate=*` in production (Pitfall 4), cross-region media 404 (Pitfall 5), GPX MIME type rejection (Pitfall 6)

### Phase 3: Branded Login (Independent, Parallelizable with Phase 1-2)
**Rationale:** Admin branding has zero dependencies on content type work — can run in parallel with Phase 1-2 if bandwidth allows. The nginx redirect approach is the simplest and most stable path: zero Strapi code changes, no risk of breaking the existing SSO monkey-patch, survives future Strapi upgrades.
**Delivers:** DCR34 logo and theme on admin panel (logo + color scheme via `app.ts`); nginx redirect from `/use1/admin/auth/login` to OIDC SSO endpoint; admin sidebar branding
**Addresses:** Branded OIDC login table stakes feature
**Avoids:** Fetch monkey-patch fragility on Strapi upgrades (Pitfall 11)

### Phase 4: run.human CMS Client
**Rationale:** Build the run.human integration once Phase 2 confirms API shapes are stable and correct. Following the established `quota-client.ts` pattern for service discovery ensures architectural consistency. TypeScript interfaces derived from verified API responses, not speculative shapes.
**Delivers:** `apps/run.human/webapp/src/lib/cms-client.ts` with service discovery and fetch wrapper; TypeScript interfaces for Event/Route/POI API responses; `CMS_INTERNAL_URL` env var in run.human `service.hcl`; populate query patterns documented and tested end-to-end
**Addresses:** REST API consumption for run.human, populate support, field selection, filtering/sorting, draft/publish filtering
**Avoids:** run.human calling master instead of workers (Anti-Pattern 2), client-side CMS calls from browser (Anti-Pattern 3), using numeric `id` instead of `documentId` (Pitfall 15)

### Phase 5: Public Role Permissions + Production Deploy
**Rationale:** Permissions must be configured after content types exist (Strapi only shows content types in the permissions admin UI after they are defined). Bootstrap programmatically via a Strapi bootstrap script to avoid the manual-step problem across environments — permissions stored in SQLite on master replicate to workers via Litestream. Deploy workers before master to minimize the schema-migration mismatch window.
**Delivers:** Public role `find`/`findOne` permissions bootstrapped automatically on first run; CMS and run.human deployed to production; end-to-end flow verified (organizer creates event on master, run.human reads it from worker in both regions within ~5 minutes)
**Addresses:** REST API public permissions, draft/publish workflow, multi-region deployment
**Avoids:** 403 Forbidden on new content types (Pitfall 8), schema migration order issue (Pitfall 9), basePath double-prefix on deploy (Pitfall 16), missing SOPS/mock outputs (Pitfall 14)

### Phase Ordering Rationale

- Pitfall 1 (sync script) is in Phase 1 because it becomes dangerous the moment any content type exists and run.human starts reading workers — cannot defer this
- S3 provider upgrade is in Phase 1 (not Phase 2) because it is a codebase change that must be baked into the Docker image before media upload testing in Phase 2
- Phase 3 (branded login) is fully decoupled — can run in parallel with Phase 1-2 or be done independently
- Phase 4 is deliberately after Phase 2 so run.human integration is built against verified, stable API shapes
- Phase 5 is last because REST API permissions require content types to exist, and deployment gates on all prior phases being verified

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (sync script fix):** The restart-based sync approach is confirmed correct, but the exact implementation details — supervisord signal handling, sync script refactor to stop/restore/start without a race condition — need to be designed against the actual `litestream-sync.sh` and `supervisord.conf` source before writing code
- **Phase 3 (nginx redirect):** Need to verify the exact nginx `location` block syntax integrates cleanly with the existing region-prefix routing rules in the current `nginx.conf`

Phases with standard patterns (skip additional research):
- **Phase 2 (media/relations testing):** Well-documented Strapi 5 patterns; research covers populate syntax and S3 flow end-to-end
- **Phase 4 (CMS client):** Established pattern from `quota-client.ts`; TypeScript types derived from API testing results
- **Phase 5 (deploy):** Same deploy playbook as v1.0; complete checklist documented in PITFALLS.md from retrospective

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official Strapi 5 docs; S3 provider upgrade verified with config examples from official docs |
| Features | HIGH | Domain model derived from project context + GPX standards + running event platform patterns; complete schema skeletons ready to implement |
| Architecture | HIGH | Based on direct codebase analysis of `apps/run.cms/`; master-worker patterns, service discovery, CloudFront routing all verified from existing code |
| Pitfalls | HIGH (critical 4), MEDIUM (2) | DB corruption (P1), schema overwrite (P2), relation misconfiguration (P3), populate defaults (P4) are HIGH confidence — documented bugs and SQLite spec. Media cross-region (P5) and GPX MIME type (P6) are MEDIUM — need empirical verification |

**Overall confidence:** HIGH

### Gaps to Address

- **Litestream sync fix implementation:** The restart-based approach is the right direction, but the exact implementation (supervisord signal handling, sync script refactor) needs to be designed against the actual `litestream-sync.sh` and `supervisord.conf` source before Phase 1 coding begins
- **GPX MIME type acceptance:** Strapi's default upload MIME type policy for `allowedTypes: ["files"]` needs empirical testing with actual .gpx files from Chrome and Firefox before declaring Route content type complete
- **CloudFront origin routing for cross-region media:** The assumption that CloudFront routes `/use1/cms/*` to the us-east-1 S3 bucket from all edge locations needs infrastructure config review before Phase 2 media testing
- **Draft/publish strategy decision:** Research documents two valid options (`draftAndPublish: false` for simplicity vs. `true` with organizer training for content staging). Must decide before Phase 1 schema creation — changing this after content is created requires a DB migration and content re-entry

## Sources

### Primary (HIGH confidence)
- [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models) — schema.json format, attribute types, relation syntax
- [Strapi 5 REST API Populate & Select](https://docs.strapi.io/cms/api/rest/populate-select) — population syntax, field selection
- [Strapi 5 Relations REST API](https://docs.strapi.io/cms/api/rest/relations) — connect/disconnect/set operations, inversedBy/mappedBy
- [Strapi 5 Content-Type Builder](https://docs.strapi.io/cms/features/content-type-builder) — field type catalog, enumeration configuration
- [Strapi 5 Amazon S3 Provider](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3) — v5 config format with s3Options nesting
- [Strapi 5 Admin Panel Customization](https://docs.strapi.io/cms/admin-panel-customization) — logo, theme, app.tsx config
- [Strapi 5 Users & Permissions](https://docs.strapi.io/cms/features/users-permissions) — Public role, permission configuration
- [Strapi 5 Draft & Publish](https://docs.strapi.io/cms/features/draft-and-publish) — status parameter, default behavior
- [SQLite WAL Documentation](https://sqlite.org/wal.html) — WAL mode, WAL/SHM file relationships
- [Litestream Tips & Caveats](https://litestream.io/tips/) — restore behavior, WAL handling caveats
- [GPX 1.1 Schema Standard](https://www.topografix.com/gpx.asp) — GPX file structure reference
- Internal codebase: `apps/run.cms/app/litestream-sync.sh`, `config/plugins.ts`, `config/database.ts`, `src/admin/app.tsx`, `infra/terraform/live/site/services/run.cms/service.hcl`
- Internal codebase: `apps/run.human/webapp/src/lib/quota-client.ts` — service discovery pattern reference

### Secondary (MEDIUM confidence)
- [Strapi 5 Understanding Populate](https://docs.strapi.io/cms/api/rest/guides/understanding-populate) — deep populate patterns
- [Strapi Rich Text Blocks + Next.js](https://strapi.io/blog/integrating-strapi-s-new-rich-text-block-editor-with-next-js-a-step-by-step-guide) — blocks renderer integration pattern
- [strapi/strapi#21753](https://github.com/strapi/strapi/issues/21753) — CTB overwrites schema.json (confirmed bug, active as of 5.6)
- [benbjohnson/litestream#58](https://github.com/benbjohnson/litestream/issues/58) — rules for Litestream-compatible applications
- [Strapi Forum: Cannot populate many-to-many relation](https://forum.strapi.io/t/cannot-populate-many-to-many-relation/20733) — silent failure patterns for mismatched relations
- `.planning/RETROSPECTIVE.md` — v1.0 deployment lessons (deployment checklist, fragile areas)
- `.planning/codebase/CONCERNS.md` — CMS fragile areas audit (SSO monkey-patch, sync script)

### Tertiary (LOW confidence)
- [Strapi GeoData Plugin](https://market.strapi.io/plugins/strapi-geodata) — informed decision to use shared component instead of plugin for coordinates
- [RACE RESULT Timing Software](https://www.raceresult.com/en/software/index) — reference for anti-feature scoping (live timing out of scope)

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*
