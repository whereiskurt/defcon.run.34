# Phase 6: Relations + API Verification - Research

**Researched:** 2026-03-02
**Domain:** Strapi 5 content type relations, REST API configuration, public permissions
**Confidence:** HIGH

## Summary

Phase 6 wires bidirectional many-to-many relations between the three content types created in Phase 5 (Event, Route, Point of Interest), adds an `eventType` enumeration field to Events, configures the Strapi Public role to allow unauthenticated read access to the REST API, and verifies the API returns properly populated, filterable responses.

The work is entirely within Strapi 5's native capabilities. Relations are defined declaratively in `schema.json` files using `inversedBy`/`mappedBy` syntax. Public permissions can be set programmatically in the bootstrap function. The REST API populate, fields, and filters parameters are well-documented Strapi 5 features. There are no external libraries to install.

**Primary recommendation:** Add relation fields to existing schema.json files, add `eventType` enum to the Event schema, configure public `find`/`findOne` permissions via bootstrap, and verify with curl scripts against a running Strapi instance.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Event<->Route: bidirectional many-to-many. Field on Event: `routes` (plural). Field on Route: `events` (plural).
- Route<->POI: bidirectional many-to-many. Field on Route: `pointsOfInterest` (camelCase, full name). Field on POI: `routes` (plural).
- No direct Event<->POI relation -- POIs accessed via Event->Routes->POIs population chain.
- Strapi default admin UX for relation pickers (searchable dropdown).
- Add `eventType` enumeration field to Event schema to enable type-based filtering (API-03). Claude picks the enum values based on DCR34 context.
- Raw Strapi blocks JSON for rich text fields -- Phase 8 blocks-renderer handles rendering client-side.
- Strapi default pagination (25/page) -- content set is small (~10-20 events, ~5-10 routes, ~20-30 POIs).
- Published content only in public API responses -- drafts visible only in Strapi admin panel.
- Date range filtering on Events: `?filters[startDatetime][$gte]=X&[$lte]=Y` -- run.human picks the range.
- Type filtering: Events by `eventType`, Routes by `routeType`, POIs by `poiType` (existing enums).
- Slug filtering: exact match only (`?filters[slug][$eq]=day-1-run`).
- Public role gets read-only access: `find` and `findOne` on all three content types.
- All fields on all content types publicly readable -- no sensitive data, this is public event information.
- Write operations (create/update/delete) remain admin-only via Strapi admin authentication.
- No Strapi-level rate limiting -- WAF + CloudFront already handle abuse protection.

### Claude's Discretion
- Population defaults configuration (Strapi default is none; Phase 8 client will use explicit `?populate=`).
- Media URL strategy (S3 direct vs CloudFront rewrite -- based on existing upload provider setup).
- Exact eventType enum values.
- API verification approach (curl scripts, test files, etc.).

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHM-05 | Events and Routes linked via bidirectional many-to-many relation | Schema.json `manyToMany` relation syntax with `inversedBy`/`mappedBy` documented in Architecture Patterns section |
| SCHM-06 | Routes and POIs linked via bidirectional many-to-many relation | Same pattern as SCHM-05, applied to Route<->POI |
| API-01 | Published events, routes, and POIs accessible via REST API without authentication (Public role) | Bootstrap permission pattern documented in Code Examples section; Strapi default returns only published content |
| API-02 | REST API supports population of relations and media (events->routes, routes->POIs+GPX URLs) | Deep populate syntax documented in Architecture Patterns and Code Examples sections |
| API-03 | REST API supports field selection and filtering (by date, type, slug) | Filter syntax with `$eq`, `$gte`, `$lte` and field selection documented in Code Examples section |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @strapi/strapi | ^5.6.0 | CMS framework | Already installed; relations, permissions, REST API are built-in |
| @strapi/plugin-users-permissions | ^5.6.0 | Public/Authenticated role management | Already installed; provides Public role and permission system |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| qs | (built into Strapi) | URL query string encoding for nested params | When building complex populate/filter queries for verification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bootstrap permissions script | Manual admin panel setup | Admin panel requires human click-through each deploy; bootstrap is reproducible and idempotent |
| Programmatic permission via bootstrap | Strapi policy files | Policies are route-level middleware, not role permissions -- different mechanism |

**Installation:**
```bash
# No new packages required -- all capabilities are built into Strapi 5
```

## Architecture Patterns

### Recommended File Structure Changes
```
apps/run.cms/app/src/
├── api/
│   ├── event/content-types/event/schema.json       # ADD: routes relation + eventType enum
│   ├── route/content-types/route/schema.json        # ADD: events + pointsOfInterest relations
│   └── point-of-interest/content-types/point-of-interest/schema.json  # ADD: routes relation
├── index.ts                                          # MODIFY: add public permission bootstrap
└── (no new files needed -- Strapi auto-generates API endpoints from schemas)
```

### Pattern 1: Bidirectional Many-to-Many Relations (inversedBy/mappedBy)

**What:** One side is the "owning" side (uses `inversedBy`), the other is the "inverse" side (uses `mappedBy`). This creates a single join table in the database. The owning side determines which join table Strapi uses.

**When to use:** For all bidirectional many-to-many relations in Strapi 5.

**Critical rule:** One side MUST use `inversedBy` and the other MUST use `mappedBy`. If both use `inversedBy`, Strapi creates TWO join tables, leading to data stored in one table being invisible from the other side.

**Example -- Event (owning side) to Route (inverse side):**
```json
// In event/schema.json -- OWNING side (inversedBy)
{
  "attributes": {
    "routes": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::route.route",
      "inversedBy": "events"
    }
  }
}

// In route/schema.json -- INVERSE side (mappedBy)
{
  "attributes": {
    "events": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::event.event",
      "mappedBy": "routes"
    }
  }
}
```
Source: [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models)

**Key syntax details:**
- `target` uses the full UID format: `api::{singularName}.{singularName}` (e.g., `api::route.route`, `api::event.event`, `api::point-of-interest.point-of-interest`)
- `inversedBy` value is the **field name** on the **target** content type (NOT the content type name)
- `mappedBy` value is the **field name** on the **source** content type that this maps back to

### Pattern 2: REST API Deep Population

**What:** Strapi 5 REST API returns no relations by default. Clients must use `?populate=` to request related data. Nested population uses bracket notation.

**When to use:** Always -- Strapi returns flat data without populate.

**Example -- Populate events with their routes and routes' POIs:**
```
# Level 1: Event with its routes
GET /api/events?populate=routes

# Level 1: Event with routes + media
GET /api/events?populate[0]=routes&populate[1]=coverImage

# Level 2: Event -> routes -> POIs (deep)
GET /api/events?populate[routes][populate][0]=pointsOfInterest

# Level 2: Event -> routes -> POIs + GPX files
GET /api/events?populate[routes][populate][0]=pointsOfInterest&populate[routes][populate][1]=gpxFiles

# Wildcard: all first-level relations + media
GET /api/events?populate=*
```
Source: [Strapi 5 Populate and Select](https://docs.strapi.io/cms/api/rest/populate-select)

### Pattern 3: Bootstrap Public Permissions (Idempotent)

**What:** Configure Public role permissions programmatically in `src/index.ts` bootstrap function. Uses `isFirstRun` guard with Strapi's plugin store to avoid re-running on every restart.

**When to use:** For reproducible deployments where permissions must be configured without manual admin panel interaction.

**Example:**
```typescript
async bootstrap({ strapi }) {
  // ... existing bootstrap code ...

  // Configure public API permissions (idempotent)
  await ensurePublicPermissions(strapi);
}

async function ensurePublicPermissions(strapi) {
  const pluginStore = strapi.store({
    type: 'plugin',
    name: 'users-permissions',
  });

  const publicPermissionsConfigured = await pluginStore.get({
    key: 'publicPermissionsConfigured',
  });

  if (publicPermissionsConfigured) {
    return; // Already configured
  }

  // Find the Public role
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    strapi.log.warn('[Bootstrap] Public role not found');
    return;
  }

  // Define which actions to enable for public access
  const publicActions = [
    { action: 'api::event.event.find' },
    { action: 'api::event.event.findOne' },
    { action: 'api::route.route.find' },
    { action: 'api::route.route.findOne' },
    { action: 'api::point-of-interest.point-of-interest.find' },
    { action: 'api::point-of-interest.point-of-interest.findOne' },
  ];

  // Find or create permissions for each action
  for (const { action } of publicActions) {
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: publicRole.id } });

    if (existing) {
      await strapi.query('plugin::users-permissions.permission').update({
        where: { id: existing.id },
        data: { enabled: true },
      });
    } else {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action, role: publicRole.id, enabled: true },
      });
    }
  }

  await pluginStore.set({
    key: 'publicPermissionsConfigured',
    value: true,
  });

  strapi.log.info('[Bootstrap] Public API permissions configured');
}
```
Source: [Strapi Community Forum](https://forum.strapi.io/t/how-can-i-bootstrap-public-role-to-have-create-permissions/1044), [Strapi Forum Discussion](https://forum.strapi.io/t/set-permissions-programmatically-6294/1774)

**Confidence: MEDIUM** -- The bootstrap permission approach is well-established in Strapi 4.x and the query API is the same in Strapi 5, but the exact permission action format (`api::event.event.find`) should be verified against a running Strapi 5 instance. An alternative approach is to use the `strapi.service('plugin::users-permissions.role').updateRole()` method which operates on the role's full permission object.

### Anti-Patterns to Avoid
- **Both sides using `inversedBy`:** Creates duplicate join tables. One side MUST use `inversedBy`, the other MUST use `mappedBy`. Strapi 4.6+ warns about this, but it still silently breaks data visibility.
- **Relying on `populate=*` for production:** Wildcard populate only goes 1 level deep. For Event->Routes->POIs, explicit nested populate is required.
- **Hardcoding media URLs:** The S3 upload provider already constructs CloudFront URLs via `baseUrl` config. Media URLs in API responses are already correct (e.g., `https://cms.defcon.run/use1/cms/image.png`). Do not transform them.
- **Custom controllers for standard CRUD:** Strapi auto-generates find/findOne/create/update/delete controllers. Do not create custom controllers unless adding non-standard behavior.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| API endpoints | Custom Express routes | Strapi auto-generated REST API | Strapi creates GET/POST/PUT/DELETE endpoints automatically from schema.json |
| Permission system | Custom auth middleware for /api/* | Strapi Public role permissions | Built-in, tested, handles draft/publish visibility correctly |
| Query string parsing | Manual URL building for populate/filter | `qs` library (built into Strapi) | Handles nested bracket notation without encoding bugs |
| Draft/publish filtering | Custom middleware to filter drafts | Strapi built-in status parameter | Default behavior returns only published content; no code needed |
| Relation management | Direct SQL join table manipulation | Strapi relation API (connect/disconnect/set) | Handles join table, inverse updates, and cache invalidation |

**Key insight:** Strapi 5 generates the entire REST API from schema.json declarations. Phase 6 requires zero custom controllers, routes, or services. All work is schema modifications + permission configuration + verification.

## Common Pitfalls

### Pitfall 1: inversedBy/mappedBy Mismatch (Silent Data Loss)
**What goes wrong:** Both sides of a many-to-many relation use `inversedBy`. Strapi creates two separate join tables. Data written via one side is invisible from the other side. Populating the "wrong" side returns empty arrays.
**Why it happens:** The field names look symmetric; developers assume both sides should declare the same way.
**How to avoid:** Always pair `inversedBy` on the owning side with `mappedBy` on the inverse side. The `mappedBy` value must reference the **field name** on the owning content type, not the content type name itself.
**Warning signs:** Populating a relation returns `[]` even though data was added from the other side. The Strapi log may show a deprecation warning about `inversedBy`.
**Confidence: HIGH** -- Verified via [GitHub issue #14428](https://github.com/strapi/strapi/issues/14428) and [PR #15217](https://github.com/strapi/strapi/pull/15217).

### Pitfall 2: Population Returns Empty Without Explicit populate Parameter
**What goes wrong:** API responses return `null` or missing relation data. Developer assumes relations are broken.
**Why it happens:** Strapi 5 REST API returns NO relation data by default. You must use `?populate=fieldName`.
**How to avoid:** Always include `?populate=` in API requests. For verification, use `?populate=*` to confirm relations exist, then use explicit populate for production queries.
**Warning signs:** API response has the relation field absent or null.
**Confidence: HIGH** -- [Strapi 5 Populate Documentation](https://docs.strapi.io/cms/api/rest/populate-select).

### Pitfall 3: Public Role Not Configured (403 on Unauthenticated Requests)
**What goes wrong:** Unauthenticated GET requests to `/api/events` return 403 Forbidden.
**Why it happens:** Strapi content types are private by default. The Public role must be explicitly granted `find` and `findOne` permissions.
**How to avoid:** Configure permissions via bootstrap script (reproducible) or manually through admin panel Settings -> Users & Permissions -> Roles -> Public.
**Warning signs:** 403 status on GET requests without Authorization header.
**Confidence: HIGH** -- [Strapi Users & Permissions Documentation](https://docs.strapi.io/cms/features/users-permissions).

### Pitfall 4: Target UID Format Incorrect
**What goes wrong:** Strapi fails to start or silently ignores the relation.
**Why it happens:** The `target` field in relation schema uses the UID format `api::singularName.singularName`. For hyphenated names like `point-of-interest`, the target is `api::point-of-interest.point-of-interest`.
**How to avoid:** Use the exact `singularName` from the target content type's `info.singularName` in the schema.json.
**Warning signs:** Strapi startup errors about unknown content types, or relation fields that don't appear in admin panel.
**Confidence: HIGH** -- [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models).

### Pitfall 5: Field Selection Does Not Work on Relations
**What goes wrong:** Using `?fields[0]=name&fields[1]=routes` does not return route data.
**Why it happens:** Strapi's `fields` parameter only works on scalar attributes of the main entity. Relations, media, components, and dynamic zones must use `populate` instead.
**How to avoid:** Use `fields` for scalar attribute selection, `populate` for relations/media/components. They can be combined.
**Warning signs:** Relation data missing despite being listed in `fields`.
**Confidence: HIGH** -- [Strapi 5 Populate and Select Documentation](https://docs.strapi.io/cms/api/rest/populate-select).

## Code Examples

Verified patterns from official sources and codebase analysis:

### Adding Relations to Existing Event Schema
```json
// apps/run.cms/app/src/api/event/content-types/event/schema.json
// ADD to "attributes" object:
"eventType": {
  "type": "enumeration",
  "enum": ["run", "social", "swag-swap", "workshop", "ceremony", "meetup"],
  "required": false
},
"routes": {
  "type": "relation",
  "relation": "manyToMany",
  "target": "api::route.route",
  "inversedBy": "events"
}
```
Source: [Strapi 5 Models](https://docs.strapi.io/cms/backend-customization/models)

### Adding Relations to Route Schema
```json
// apps/run.cms/app/src/api/route/content-types/route/schema.json
// ADD to "attributes" object:
"events": {
  "type": "relation",
  "relation": "manyToMany",
  "target": "api::event.event",
  "mappedBy": "routes"
},
"pointsOfInterest": {
  "type": "relation",
  "relation": "manyToMany",
  "target": "api::point-of-interest.point-of-interest",
  "inversedBy": "routes"
}
```

### Adding Relations to POI Schema
```json
// apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json
// ADD to "attributes" object:
"routes": {
  "type": "relation",
  "relation": "manyToMany",
  "target": "api::route.route",
  "mappedBy": "pointsOfInterest"
}
```

### Relation Ownership Summary
```
Event.routes ---[inversedBy: "events"]---> Route     (Event is OWNER)
Route.events ---[mappedBy: "routes"]-----> Event     (Route is INVERSE)

Route.pointsOfInterest ---[inversedBy: "routes"]---> POI    (Route is OWNER)
POI.routes ---[mappedBy: "pointsOfInterest"]--------> Route  (POI is INVERSE)
```

### REST API Filter Examples
```bash
# Filter events by date range
curl "http://localhost:1337/api/events?filters[startDatetime][\$gte]=2026-08-07T00:00:00.000Z&filters[startDatetime][\$lte]=2026-08-10T23:59:59.000Z"

# Filter events by type
curl "http://localhost:1337/api/events?filters[eventType][\$eq]=run"

# Filter routes by type
curl "http://localhost:1337/api/routes?filters[routeType][\$eq]=loop"

# Filter by slug (exact match)
curl "http://localhost:1337/api/events?filters[slug][\$eq]=day-1-run"

# Filter POIs by type
curl "http://localhost:1337/api/points-of-interest?filters[poiType][\$eq]=water-station"
```
Source: [Strapi 5 Filters Documentation](https://docs.strapi.io/cms/api/rest/filters)

### REST API Populate Examples
```bash
# Event with routes (1 level)
curl "http://localhost:1337/api/events?populate=routes"

# Event with all first-level relations and media
curl "http://localhost:1337/api/events?populate=*"

# Event with routes and their POIs (2 levels deep)
curl "http://localhost:1337/api/events?populate[routes][populate][0]=pointsOfInterest"

# Event with routes (including their GPX files and POIs)
curl "http://localhost:1337/api/events?populate[routes][populate][0]=pointsOfInterest&populate[routes][populate][1]=gpxFiles"

# Single event by documentId with full population
curl "http://localhost:1337/api/events/DOCUMENT_ID?populate[routes][populate][0]=pointsOfInterest&populate[routes][populate][1]=gpxFiles&populate[0]=coverImage"

# Route with events and POIs
curl "http://localhost:1337/api/routes?populate[0]=events&populate[1]=pointsOfInterest"

# Field selection (scalar fields only)
curl "http://localhost:1337/api/events?fields[0]=title&fields[1]=slug&fields[2]=startDatetime&populate=routes"
```
Source: [Strapi 5 Populate and Select](https://docs.strapi.io/cms/api/rest/populate-select), [Understanding Populate](https://docs.strapi.io/cms/api/rest/guides/understanding-populate)

### eventType Enum Values (Claude's Discretion)
Based on DCR34 context -- DEF CON 34 is a fun run event with social activities:
```json
"eventType": {
  "type": "enumeration",
  "enum": ["run", "social", "swag-swap", "workshop", "ceremony", "meetup"],
  "required": false
}
```
- `run` -- Organized running events (5K, 10K, fun run)
- `social` -- Social gatherings, parties, after-parties
- `swag-swap` -- Swag exchange meetups
- `workshop` -- Skill workshops (stretching, running form, etc.)
- `ceremony` -- Opening/closing ceremonies, awards
- `meetup` -- Informal meetups and group activities

**Confidence: MEDIUM** -- Values are reasonable for a DEF CON running event but should be reviewed with the organizer.

### Media URL Strategy (Claude's Discretion)
The existing S3 upload provider in `config/plugins.ts` already configures:
- `baseUrl`: `https://cms.defcon.run` (CloudFront CDN)
- `rootPath`: `{regionShort}/cms` (e.g., `use1/cms`)

This means media URLs in API responses are already CloudFront URLs like:
```
https://cms.defcon.run/use1/cms/uploads/cover_image_abc123.jpg
```

**Recommendation:** No special media URL handling needed. Strapi's S3 provider constructs the correct CloudFront URLs automatically. Phase 8 client uses URLs as-is from API responses.

**Confidence: HIGH** -- Verified from `apps/run.cms/app/config/plugins.ts` source code.

### Population Defaults (Claude's Discretion)
**Recommendation:** Leave Strapi's default (no population). Phase 8's run.human client will use explicit `?populate=` parameters to request exactly the data it needs. This keeps API responses lean and predictable.

**Confidence: HIGH** -- Strapi default behavior is well-documented and matches the CONTEXT.md decision.

### API Verification Approach (Claude's Discretion)
**Recommendation:** Create a shell script (`scripts/verify-api.sh`) that:
1. Checks Strapi is running
2. Tests unauthenticated GET requests to all three endpoints
3. Tests population (1-level and 2-level deep)
4. Tests filtering by date, type, and slug
5. Verifies response shape includes expected fields
6. Exits with pass/fail status

This is simpler and more portable than a test framework (no test runner dependency in the CMS app). The script can be run manually or in CI.

**Confidence: HIGH** -- Shell scripts with curl are the standard lightweight API verification approach.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Strapi v4 `publicationState=live` | Strapi v5 `status=published` (default) | Strapi 5.0 | Default returns published only; no need to filter |
| Strapi v4 nested `data.attributes` | Strapi v5 flat `data` | Strapi 5.0 | Response shape is simpler; attributes directly on data object |
| Strapi v4 integer IDs | Strapi v5 `documentId` (string) | Strapi 5.0 | Use `documentId` for findOne and relation connect/disconnect |
| Manual permission setup | Bootstrap script + plugin store guard | Community pattern | Reproducible across environments |

**Deprecated/outdated:**
- `publicationState` parameter: Replaced by `status` in Strapi 5. Use `?status=published` (or omit, since it's the default).
- `data.attributes` nesting: Strapi 5 flattened response format. Attributes are directly on the `data` object.
- Integer `id` for REST operations: Use `documentId` (string) for REST API findOne, update, delete, and relation operations.

## Open Questions

1. **Exact permission action format in Strapi 5**
   - What we know: Strapi 4 used `api::event.event.find` format. Strapi 5 likely uses the same.
   - What's unclear: Whether the exact action string format changed in Strapi 5 or whether additional permission fields are needed.
   - Recommendation: During implementation, inspect the permission records in the database after manual admin panel configuration to confirm the exact format, then use that in the bootstrap script. Alternatively, test the bootstrap approach directly -- if Strapi rejects the action string, it will log an error.

2. **Bootstrap permission idempotency on existing deployments**
   - What we know: The `isFirstRun` guard pattern using plugin store works for fresh databases.
   - What's unclear: On existing deployments with manually configured permissions, the bootstrap should not override them.
   - Recommendation: Use a dedicated plugin store key (`publicPermissionsConfigured`) that only runs once. If permissions need to be reconfigured, the store key can be cleared in the database.

## Sources

### Primary (HIGH confidence)
- [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models) -- relation syntax, inversedBy/mappedBy, target UID format
- [Strapi 5 Populate and Select](https://docs.strapi.io/cms/api/rest/populate-select) -- populate parameter syntax, field selection
- [Strapi 5 Understanding Populate](https://docs.strapi.io/cms/api/rest/guides/understanding-populate) -- deep population, nested bracket notation
- [Strapi 5 Filters](https://docs.strapi.io/cms/api/rest/filters) -- filter operators ($eq, $gte, $lte), date filtering, complex filters
- [Strapi 5 REST API Reference](https://docs.strapi.io/cms/api/rest) -- endpoint patterns, pagination defaults, response format
- [Strapi 5 Status/Draft-Publish](https://docs.strapi.io/cms/api/rest/status) -- status parameter, default published behavior
- [Strapi 5 Relations REST API](https://docs.strapi.io/cms/api/rest/relations) -- connect/disconnect/set syntax with documentId
- [Strapi 5 Users & Permissions](https://docs.strapi.io/cms/features/users-permissions) -- Public/Authenticated roles

### Secondary (MEDIUM confidence)
- [Strapi Forum: Bootstrap Public Permissions](https://forum.strapi.io/t/how-can-i-bootstrap-public-role-to-have-create-permissions/1044) -- bootstrap pattern verified across multiple Strapi versions
- [Strapi Forum: Set Permissions Programmatically](https://forum.strapi.io/t/set-permissions-programmatically-6294/1774) -- service-based permission update approach
- [GitHub PR #15217: Warn for duplicated inversedBy](https://github.com/strapi/strapi/pull/15217) -- Strapi 4.6+ warns about inversedBy/mappedBy mismatch
- [GitHub Issue #14428: Two join tables for M2M](https://github.com/strapi/strapi/issues/14428) -- root cause of dual-inversedBy bug

### Tertiary (LOW confidence)
- eventType enum values -- Inferred from DCR34 context, not confirmed with organizer

## Existing Codebase Context

### Middleware Compatibility (VERIFIED)
Both custom middlewares (`cookie-auth.ts` and `services-validation.ts`) explicitly check for admin routes (`/admin` or `/{region}/admin`) and skip all other routes. Public API requests to `/api/*` will NOT be intercepted by these middlewares.

### CORS Configuration (VERIFIED)
The CORS config in `config/middlewares.ts` includes `https://run.defcon.run` in the origin list. Phase 8's run.human client will be able to make cross-origin requests to the CMS API.

### Upload Provider (VERIFIED)
Media URLs use CloudFront CDN (`https://cms.defcon.run/{region}/cms/...`). No URL rewriting needed in Phase 6.

### Bootstrap Function (VERIFIED)
`src/index.ts` already has a bootstrap function with admin user seeding. Public permission configuration will be added to this existing function.

### API Endpoint Paths (VERIFIED)
Based on the schema singularName/pluralName:
- Events: `/api/events` and `/api/events/:documentId`
- Routes: `/api/routes` and `/api/routes/:documentId`
- POIs: `/api/points-of-interest` and `/api/points-of-interest/:documentId`

Note: CONTEXT.md mentions `/api/pois` in success criteria #3, but Strapi generates the endpoint from the `pluralName` field. The POI schema has `"pluralName": "points-of-interest"`, so the actual endpoint is `/api/points-of-interest`. This does NOT require a change -- the success criteria should be read as functional intent ("POI content is accessible via API"), not literal URL path.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All capabilities are built into Strapi 5; no external libraries needed
- Architecture: HIGH -- Relation syntax, populate, and filter patterns verified against official Strapi 5 docs
- Pitfalls: HIGH -- inversedBy/mappedBy mismatch bug verified via GitHub issues and PRs; population default behavior verified via docs
- Permissions bootstrap: MEDIUM -- Pattern well-established in community but exact Strapi 5 action strings should be verified at runtime

**Research date:** 2026-03-02
**Valid until:** 2026-04-01 (stable -- Strapi 5 relation and REST API patterns are mature)
