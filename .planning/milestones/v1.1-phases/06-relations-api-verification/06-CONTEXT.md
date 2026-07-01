# Phase 6: Relations + API Verification - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire bidirectional many-to-many relations between Event↔Route and Route↔POI content types, add an eventType enum to Events, configure public read-only REST API permissions, and verify the API returns fully populated, filterable content for run.human consumption. No direct Event↔POI relation — POIs are reached through Routes only.

</domain>

<decisions>
## Implementation Decisions

### Relation structure
- Event↔Route: bidirectional many-to-many
  - Field on Event: `routes` (plural)
  - Field on Route: `events` (plural)
- Route↔POI: bidirectional many-to-many
  - Field on Route: `pointsOfInterest` (camelCase, full name)
  - Field on POI: `routes` (plural)
- No direct Event↔POI relation — POIs accessed via Event→Routes→POIs population chain
- Strapi default admin UX for relation pickers (searchable dropdown)

### Event type enum (schema addition)
- Add `eventType` enumeration field to Event schema to enable type-based filtering (API-03)
- Claude picks the enum values based on DCR34 context (run, social, swag-swap, workshop, etc.)

### API response shape
- Raw Strapi blocks JSON for rich text fields — Phase 8 blocks-renderer handles rendering client-side
- Strapi default pagination (25/page) — content set is small (~10-20 events, ~5-10 routes, ~20-30 POIs)
- Published content only in public API responses — drafts visible only in Strapi admin panel

### Filtering capabilities
- Date range filtering on Events: `?filters[startDatetime][$gte]=X&[$lte]=Y` — run.human picks the range
- Type filtering: Events by `eventType`, Routes by `routeType`, POIs by `poiType` (existing enums)
- Slug filtering: exact match only (`?filters[slug][$eq]=day-1-run`)

### Public API permissions
- Public role gets read-only access: `find` and `findOne` on all three content types
- All fields on all content types publicly readable — no sensitive data, this is public event information
- Write operations (create/update/delete) remain admin-only via Strapi admin authentication
- No Strapi-level rate limiting — WAF + CloudFront already handle abuse protection

### Claude's Discretion
- Population defaults configuration (Strapi default is none; Phase 8 client will use explicit `?populate=`)
- Media URL strategy (S3 direct vs CloudFront rewrite — based on existing upload provider setup)
- Exact eventType enum values
- API verification approach (curl scripts, test files, etc.)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard Strapi 5 approaches for relations and permissions.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Event schema: `apps/run.cms/app/src/api/event/content-types/event/schema.json` — needs eventType enum addition + routes relation
- Route schema: `apps/run.cms/app/src/api/route/content-types/route/schema.json` — needs events + pointsOfInterest relations
- POI schema: `apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json` — needs routes relation
- Shared coordinates component: `apps/run.cms/app/src/components/shared/coordinates.json` — already used by all three types

### Established Patterns
- Strapi 5.6 content type schemas with `draftAndPublish: true` — all three types already configured
- Health endpoint pattern: `apps/run.cms/app/src/api/health/` — custom route + controller pattern for reference
- Cookie-auth middleware: `apps/run.cms/app/src/middlewares/cookie-auth.ts` — existing middleware pattern

### Integration Points
- Strapi Public role permissions (configured via admin panel or bootstrap script)
- REST API endpoints: `/api/events`, `/api/routes`, `/api/points-of-interest`
- Phase 8 will consume these endpoints via service discovery (`run-cms-worker.app-{region}-dc34.local:1337`)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-relations-api-verification*
*Context gathered: 2026-03-02*
