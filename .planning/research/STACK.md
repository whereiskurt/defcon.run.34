# Technology Stack

**Project:** DCR34 CMS Content Types (cms.defcon.run) -- v1.1
**Researched:** 2026-03-02
**Scope:** Stack additions/changes for event, route, and POI content types with relations, media handling, REST API, and branded OIDC login. Base CMS infrastructure (Strapi 5.6, SQLite, Litestream, ECS Fargate, OIDC SSO) is already deployed and NOT re-researched.

## Recommended Stack

### Content Types (Zero new dependencies -- Strapi built-in)

No new packages are needed. Strapi 5 content types are defined via `schema.json` files in `src/api/[name]/content-types/[name]/`. All field types needed (relations, media, enumerations, datetime, richtext, uid) are built into Strapi 5.6.

| Capability | Mechanism | Notes |
|------------|-----------|-------|
| Content type definition | `schema.json` files in `src/api/` | No CLI needed; hand-write JSON schemas |
| Many-to-many relations | `relation: "manyToMany"` with `inversedBy`/`mappedBy` | Bidirectional; Strapi auto-creates join tables in SQLite |
| Media fields (photos, GPX, video) | `type: "media"` with `allowedTypes` and `multiple` | S3 upload provider already configured |
| Enumerations (route type, POI category) | `type: "enumeration"` with `enum` array | Rendered as dropdown in admin |
| Auto-slug from title | `type: "uid"` with `targetField` | Known bug in Strapi 5 with required UIDs; see Pitfalls |
| Draft/publish workflow | `draftAndPublish: true` in schema options | REST API returns published by default |
| REST API | Built-in at `/api/[plural-name]` | Requires enabling permissions on Public role |

**Confidence:** HIGH -- all verified against official Strapi 5 documentation.

### Content Type Schema Patterns

**Event content type** (`src/api/event/content-types/event/schema.json`):

```json
{
  "kind": "collectionType",
  "collectionName": "events",
  "info": {
    "singularName": "event",
    "pluralName": "events",
    "displayName": "Event",
    "description": "Scheduled DCR34 activities"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true,
      "minLength": 3,
      "maxLength": 200
    },
    "slug": {
      "type": "uid",
      "targetField": "title"
    },
    "description": {
      "type": "richtext"
    },
    "startDate": {
      "type": "datetime",
      "required": true
    },
    "endDate": {
      "type": "datetime"
    },
    "location": {
      "type": "string"
    },
    "coordinates": {
      "type": "json"
    },
    "photos": {
      "type": "media",
      "multiple": true,
      "required": false,
      "allowedTypes": ["images"]
    },
    "attachments": {
      "type": "media",
      "multiple": true,
      "required": false,
      "allowedTypes": ["files", "images"]
    },
    "routes": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::route.route",
      "inversedBy": "events"
    }
  }
}
```

**Route content type** (`src/api/route/content-types/route/schema.json`):

```json
{
  "kind": "collectionType",
  "collectionName": "routes",
  "info": {
    "singularName": "route",
    "pluralName": "routes",
    "displayName": "Route",
    "description": "GPX routes for DCR34 events"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true
    },
    "slug": {
      "type": "uid",
      "targetField": "title"
    },
    "description": {
      "type": "richtext"
    },
    "routeType": {
      "type": "enumeration",
      "enum": ["run", "walk", "hike", "bike", "other"],
      "default": "run",
      "required": true
    },
    "distance": {
      "type": "decimal"
    },
    "elevationGain": {
      "type": "integer"
    },
    "difficulty": {
      "type": "enumeration",
      "enum": ["easy", "moderate", "hard", "expert"],
      "default": "moderate"
    },
    "gpxFiles": {
      "type": "media",
      "multiple": true,
      "required": false,
      "allowedTypes": ["files"]
    },
    "coverImage": {
      "type": "media",
      "multiple": false,
      "required": false,
      "allowedTypes": ["images"]
    },
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
  }
}
```

**Point of Interest content type** (`src/api/point-of-interest/content-types/point-of-interest/schema.json`):

```json
{
  "kind": "collectionType",
  "collectionName": "points_of_interest",
  "info": {
    "singularName": "point-of-interest",
    "pluralName": "points-of-interest",
    "displayName": "Point of Interest",
    "description": "Reusable landmarks and waypoints"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "name": {
      "type": "string",
      "required": true
    },
    "slug": {
      "type": "uid",
      "targetField": "name"
    },
    "description": {
      "type": "richtext"
    },
    "category": {
      "type": "enumeration",
      "enum": ["water", "aid-station", "landmark", "viewpoint", "hazard", "parking", "restroom", "start-finish", "other"],
      "required": true
    },
    "coordinates": {
      "type": "json",
      "required": true
    },
    "photo": {
      "type": "media",
      "multiple": false,
      "required": false,
      "allowedTypes": ["images"]
    },
    "routes": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::route.route",
      "mappedBy": "pointsOfInterest"
    }
  }
}
```

### Relation Architecture

```
Event <--manyToMany--> Route <--manyToMany--> PointOfInterest
  |                       |                        |
  inversedBy: events      mappedBy: routes         mappedBy: pointsOfInterest
  (on Event.routes)       (on Route.events)        (on POI.routes)
                          inversedBy: routes
                          (on Route.pointsOfInterest)
```

**Owner side** (has `inversedBy`): Event.routes, Route.pointsOfInterest
**Inverse side** (has `mappedBy`): Route.events, POI.routes

The owner side controls the join table. In Strapi 5, the owner side shows the relation picker widget in the admin panel by default.

### S3 Upload Provider -- CRITICAL UPDATE NEEDED

| Technology | Current Version | Required Version | Purpose | Why Update |
|------------|----------------|-----------------|---------|------------|
| `@strapi/provider-upload-aws-s3` | `^4.15.0` (v4) | `^5.6.0` (v5) | S3 media uploads | v4 package uses deprecated config format; v5 uses `s3Options.credentials` nesting. Currently works via backwards compatibility but will break on provider updates. |

**Current config** (in `config/plugins.ts`) -- v4 flat format:

```typescript
providerOptions: {
  accessKeyId: env('S3_MEDIA_ACCESS_KEY'),
  secretAccessKey: env('S3_MEDIA_SECRET_KEY'),
  region: env('S3_MEDIA_REGION', 'us-east-1'),
  params: { Bucket: s3Bucket, ACL: null },
  rootPath: s3RootPath,
  baseUrl: cdnBaseUrl,
}
```

**Required config** -- v5 `s3Options` format:

```typescript
providerOptions: {
  baseUrl: cdnBaseUrl,
  rootPath: s3RootPath,
  s3Options: {
    credentials: {
      accessKeyId: env('S3_MEDIA_ACCESS_KEY'),
      secretAccessKey: env('S3_MEDIA_SECRET_KEY'),
    },
    region: env('S3_MEDIA_REGION', 'us-east-1'),
    params: {
      Bucket: s3Bucket,
      ACL: null,
    },
  },
}
```

**Action required:** Update `package.json` to `"@strapi/provider-upload-aws-s3": "^5.6.0"` and refactor `config/plugins.ts` to the v5 configuration format. This is a prerequisite for media upload testing with the new content types.

**Confidence:** HIGH -- verified against official Strapi 5 S3 provider documentation.

### GPX File Handling

GPX files are XML-based (`application/gpx+xml`). Strapi's media library accepts GPX files when uploaded through media fields with `allowedTypes: ["files"]`. No special MIME type configuration is needed because:

1. Strapi's `files` allowed type accepts any non-image, non-video, non-audio file
2. S3 stores the file as-is with the detected content type
3. The consuming app (run.human) downloads the GPX file from the S3/CloudFront URL and parses it client-side

**No GPX-specific plugin is needed.** The CMS treats GPX files as opaque file attachments. Parsing/rendering is the responsibility of run.human (which already uses gpx-studio).

**Confidence:** MEDIUM -- Strapi docs confirm `files` allowedType accepts arbitrary files; GPX-specific behavior not explicitly documented but follows from general file handling.

### Branded OIDC Login Page (Zero new dependencies)

The branded login experience requires zero new packages. The approach uses three existing mechanisms:

| Layer | Mechanism | What It Does |
|-------|-----------|--------------|
| 1. Strapi admin config | `config.auth.logo` in `app.tsx` | Shows DCR34 logo on the Strapi login screen |
| 2. Strapi theme | `config.theme.light/dark` in `app.tsx` | DCR34 brand colors (replaces Strapi purple) |
| 3. Existing SSO redirect | Current `app.tsx` code | Auto-redirects to auth.defcon.run before user sees login form |

**Implementation in `src/admin/app.tsx`:**

```typescript
import AuthLogo from "./extensions/dcr34-logo.svg";
import MenuLogo from "./extensions/dcr34-logo-small.svg";

export default {
  config: {
    auth: {
      logo: AuthLogo,  // Login screen logo
    },
    menu: {
      logo: MenuLogo,  // Sidebar logo
    },
    theme: {
      light: {
        colors: {
          primary100: "#e8f5e9",  // DCR34 brand light
          primary200: "#a5d6a7",
          primary500: "#4caf50",
          primary600: "#388e3c",  // DCR34 brand primary
          primary700: "#2e7d32",
        },
      },
      dark: {
        colors: {
          primary100: "#1b5e20",
          primary200: "#2e7d32",
          primary500: "#4caf50",
          primary600: "#66bb6a",
          primary700: "#81c784",
        },
      },
    },
    locales: ['en'],
    tutorials: false,
    notifications: { releases: false },
  },
  bootstrap() {
    // Existing SSO redirect and 401 handling code stays as-is
  },
};
```

**Key insight:** The current `app.tsx` already hides the native Strapi login form (`document.documentElement.style.display = 'none'`) and redirects to SSO immediately. Users never see the Strapi login form. The branded login experience is actually the auth.defcon.run OIDC login page, not a Strapi page.

What "branded CMS login" really means is:
1. **Logo/theme branding** for the brief flash if the SSO redirect is slow (belt and suspenders)
2. **Sidebar branding** after login (DCR34 logo in navigation)
3. **auth.defcon.run login page** is already branded (it is the DCR34 login)

**Confidence:** HIGH -- `config.auth.logo` and `config.theme` verified against Strapi 5 official docs. Current SSO redirect already working in production.

### REST API Configuration (Zero new dependencies)

Strapi 5 auto-generates REST API endpoints when content types are created:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/events` | GET | List all published events |
| `GET /api/events/:documentId` | GET | Get single event |
| `GET /api/routes` | GET | List all published routes |
| `GET /api/routes/:documentId` | GET | Get single route |
| `GET /api/points-of-interest` | GET | List all published POIs |
| `GET /api/points-of-interest/:documentId` | GET | Get single POI |

**Population syntax for run.human consumption:**

```
# Get events with routes populated (1 level)
GET /api/events?populate=routes

# Get events with routes AND route cover images (deep)
GET /api/events?populate[routes][populate][0]=coverImage

# Get routes with POIs and their photos
GET /api/routes?populate[pointsOfInterest][populate][0]=photo&populate[0]=gpxFiles&populate[1]=coverImage

# Wildcard populate (all 1 level -- use sparingly)
GET /api/events?populate=*

# Pagination
GET /api/events?pagination[page]=1&pagination[pageSize]=25

# Filtering
GET /api/events?filters[routeType][$eq]=run&sort=startDate:asc

# Published only (default -- no parameter needed)
# Draft access: add status=draft
```

**Permission setup required:** After creating content types, enable `find` and `findOne` permissions for the Public role on each content type via the admin panel (Settings > Users & Permissions > Roles > Public). This is a manual step in the admin UI; Strapi does not support programmatic permission seeding.

**Important for master-worker architecture:** Workers serve the REST API for internal consumption by webapps. run.human makes private calls to the regional CMS worker (not the master). Since the SQLite database is replicated from master to workers via Litestream, all content created on the master is available on workers within seconds of replication.

**Confidence:** HIGH -- REST API pattern, populate syntax, and permission model verified against official Strapi 5 docs.

### Coordinates Format Convention

For `coordinates` JSON fields on Event and PointOfInterest:

```json
{
  "lat": 36.1699,
  "lng": -115.1398,
  "altitude": 620
}
```

Use a simple `{ lat, lng }` object (or `{ lat, lng, altitude }`). Do NOT use GeoJSON format -- it is unnecessarily complex for point locations in a CMS with no geospatial queries. SQLite has no spatial indexing anyway. run.human will consume these coordinates directly for map rendering.

**Confidence:** HIGH -- architecture decision, not a library dependency.

## What NOT to Add

| Library/Approach | Why Not |
|-----------------|---------|
| PostGIS / SpatiaLite | Overkill. We have < 100 POIs and no spatial queries. SQLite JSON fields are sufficient. |
| `strapi-plugin-slugify` | The built-in `uid` type with `targetField` handles slugs. Plugin adds unnecessary dependency. |
| `strapi-plugin-import-export-entries` | Not needed for initial content creation. Organizers create content via admin panel. |
| GraphQL plugin (`@strapi/plugin-graphql`) | REST API is sufficient for run.human. GraphQL adds complexity, larger bundle, and another attack surface. |
| Custom content type generation tools | Hand-write `schema.json` files. The Content-Type Builder UI is available for experimentation but schemas should be committed as code. |
| Strapi Cloud plugin (`@strapi/plugin-cloud`) | Already in `package.json` but serves no purpose for self-hosted deployment. Consider removing. |
| Custom GPX parser plugin | CMS stores GPX as opaque files. Parsing happens in run.human/gpx-studio, not in CMS. |
| `@strapi/plugin-documentation` (Swagger) | Internal API consumed only by run.human. Swagger docs add build time and maintenance burden for no audience. |
| Database migrations plugin | Strapi auto-migrates SQLite schema when content types change. No manual migration needed. |

## Required Changes Summary

| Change | Type | Priority | Scope |
|--------|------|----------|-------|
| Create `src/api/event/` content type | New files | P0 | 4 files (schema, controller, service, routes) |
| Create `src/api/route/` content type | New files | P0 | 4 files |
| Create `src/api/point-of-interest/` content type | New files | P0 | 4 files |
| Update `@strapi/provider-upload-aws-s3` to v5 | Package update | P0 | `package.json` + `config/plugins.ts` |
| Add logo/theme to `src/admin/app.tsx` | Modify existing | P1 | `app.tsx` + new SVG files in `extensions/` |
| Add logo SVGs to `src/admin/extensions/` | New files | P1 | 2 SVG files |
| Enable Public role REST API permissions | Manual admin step | P0 | Admin UI configuration |
| Test REST API with populate on workers | Verification | P0 | curl/fetch testing |

### File Structure After Implementation

```
apps/run.cms/app/src/
  admin/
    app.tsx                          # MODIFIED: add logo imports + theme
    extensions/
      dcr34-logo.svg                 # NEW: auth screen logo
      dcr34-logo-small.svg           # NEW: sidebar logo
    vite.config.ts                   # UNCHANGED
  api/
    event/
      content-types/
        event/
          schema.json                # NEW: event content type schema
      controllers/
        event.ts                     # NEW: default CRUD controller
      services/
        event.ts                     # NEW: default CRUD service
      routes/
        event.ts                     # NEW: default REST routes
    route/
      content-types/
        route/
          schema.json                # NEW: route content type schema
      controllers/
        route.ts                     # NEW
      services/
        route.ts                     # NEW
      routes/
        route.ts                     # NEW
    point-of-interest/
      content-types/
        point-of-interest/
          schema.json                # NEW: POI content type schema
      controllers/
        point-of-interest.ts         # NEW
      services/
        point-of-interest.ts         # NEW
      routes/
        point-of-interest.ts         # NEW
    health/                          # UNCHANGED
  middlewares/                       # UNCHANGED
  extensions/                        # UNCHANGED
```

### Default Controller/Service/Routes Pattern

Each content type needs minimal boilerplate files. Strapi 5 provides factory functions:

**Controller** (`src/api/event/controllers/event.ts`):
```typescript
import { factories } from '@strapi/strapi';
export default factories.createCoreController('api::event.event');
```

**Service** (`src/api/event/services/event.ts`):
```typescript
import { factories } from '@strapi/strapi';
export default factories.createCoreService('api::event.event');
```

**Routes** (`src/api/event/routes/event.ts`):
```typescript
import { factories } from '@strapi/strapi';
export default factories.createCoreRouter('api::event.event');
```

These one-liners give you full CRUD + REST API with zero custom logic. Custom overrides can be added later if needed.

**Confidence:** HIGH -- factory pattern verified in Strapi 5 documentation.

## Installation

```bash
# Update S3 upload provider from v4 to v5
cd apps/run.cms/app
npm install @strapi/provider-upload-aws-s3@^5.6.0

# No other new packages needed
# Content types, relations, media, REST API, and admin branding
# are all built into Strapi 5.6
```

## Master-Worker Architecture Implications

| Concern | Impact | Mitigation |
|---------|--------|------------|
| Content type schemas must be identical | Schema files are baked into Docker image at build time | Same image deployed to master and all workers -- guaranteed consistency |
| Public role permissions stored in SQLite | Permissions set on master replicate to workers via Litestream | Set permissions on master; workers auto-receive via DB replication |
| Media uploads go to S3 | Workers read media from same S3/CloudFront URLs | S3 is region-agnostic (single bucket); CloudFront serves globally |
| Draft content on master | Workers replicate full DB including drafts | REST API defaults to `status=published`; drafts only accessible with explicit parameter |
| Join tables for relations | SQLite join tables replicate via Litestream | No special handling needed; all data is in the single SQLite file |
| Content creation | Only master can write | Workers are read-only; webapps only read via REST API |

## Sources

- [Strapi 5 Content-Type Builder Documentation](https://docs.strapi.io/cms/features/content-type-builder) -- field types, relation configuration
- [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models) -- schema.json format, attribute types
- [Strapi 5 Relations Documentation](https://docs.strapi.io/cms/api/rest/relations) -- relation types, inversedBy/mappedBy
- [Strapi 5 REST API Populate and Select](https://docs.strapi.io/cms/api/rest/populate-select) -- population syntax, deep populate
- [Strapi 5 REST API Reference](https://docs.strapi.io/cms/api/rest) -- endpoint patterns, CRUD operations
- [Strapi 5 Draft & Publish](https://docs.strapi.io/cms/features/draft-and-publish) -- status parameter, default behavior
- [Strapi 5 Admin Panel Customization](https://docs.strapi.io/cms/admin-panel-customization) -- logo, theme, app.tsx config
- [Strapi 5 Logo Customization](https://docs.strapi.io/cms/admin-panel-customization/logos) -- auth logo, menu logo
- [Strapi 5 Theme Extension](https://docs.strapi.io/cms/admin-panel-customization/theme-extension) -- color tokens, light/dark modes
- [Strapi 5 Amazon S3 Provider](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3) -- v5 config format, s3Options
- [Strapi 5 Users & Permissions](https://docs.strapi.io/cms/features/users-permissions) -- Public role, permission configuration
- [Strapi 5 Media Library](https://docs.strapi.io/cms/features/media-library) -- media field types, allowedTypes
- [Strapi 5 Filters Documentation](https://docs.strapi.io/cms/api/rest/filters) -- query parameter syntax
- [Strapi UID Field Issue #21472](https://github.com/strapi/strapi/issues/21472) -- known bug with uid auto-generation
- [Strapi S3 Provider Issue #23465](https://github.com/strapi/strapi/issues/23465) -- v4/v5 compatibility issues
- [Strapi 5 Document Service Middleware](https://strapi.io/blog/what-are-document-service-middleware-and-what-happened-to-lifecycle-hooks-1) -- replaces lifecycle hooks in v5
