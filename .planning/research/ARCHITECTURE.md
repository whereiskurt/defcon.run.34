# Architecture Patterns

**Domain:** CMS content types (events, routes, POIs) with media and relations for Strapi 5.6 master-worker architecture
**Researched:** 2026-03-02

## Recommended Architecture

The v1.1 milestone adds **content types and their relations** to an already-deployed, already-working Strapi 5.6 CMS with master-worker replication. The architecture is additive -- zero infrastructure changes required. Content types are defined as schema.json files in `src/api/`, media goes to S3 via the existing upload provider, and the SQLite database (with new content tables) replicates to workers via the existing Litestream pipeline.

```
WRITE PATH (Admin / Organizers)
===================================================================

Browser (cms.defcon.run/use1/admin)
        |
        | OIDC SSO via auth.defcon.run
        v
CloudFront -> ALB (use1 only) -> nginx -> Strapi Master (use1)
        |                                       |
        | Admin creates event,                  | S3 Upload Provider:
        | uploads photos,                       | PUT photos to S3
        | links routes to POIs                  | (use1/cms/uploads/*)
        |                                       |
        v                                       v
SQLite DB -(Litestream replicate)-> S3 Bucket (cms-litestream)
                                         |
S3 Media Bucket (cms-media) <--+---------+
    use1/cms/uploads/*         |
                               | S3 Cross-Region Replication
                               v
                    S3 Media Bucket (cms-media)
                        cac1/cms/uploads/*


READ PATH (run.human / Participants)
===================================================================

run.human (Next.js SSR, any region)
        |
        | Private internal API call via service discovery
        | http://run-cms-worker.app-{region}-{site}.local:1337
        |
        v
Strapi Worker (regional, read-only)
        |
        | SQLite (restored from S3 every 5 min via litestream-sync.sh)
        | Contains: content type data, media URLs, relation tables
        |
        | Media URLs in DB point to: https://cms.defcon.run/{region}/cms/...
        | CloudFront serves these from S3 via OAC
        |
        v
JSON response with content data + CloudFront media URLs
```

### Component Boundaries

| Component | Responsibility | Communicates With | New/Modified |
|-----------|---------------|-------------------|--------------|
| **Strapi Content Types** (schema.json) | Define event, route, POI data models with relations | Strapi internal (auto-generates REST API, admin UI, DB tables) | **NEW** |
| **Strapi Master** (use1) | Admin panel, write operations, media upload to S3 | S3 (media), S3 (litestream), auth.defcon.run (OIDC) | Existing -- no changes |
| **Strapi Workers** (all regions) | Read-only REST API serving content to run.human | S3 (litestream restore), run.human (via service discovery) | Existing -- no changes |
| **S3 Media Bucket** (cms-media) | Store uploaded photos, GPX files, attachments | Strapi Master (writes), CloudFront (reads), cross-region replication | Existing -- no changes |
| **S3 Litestream Bucket** | Store SQLite replication stream | Strapi Master (writes), Workers (restores) | Existing -- no changes |
| **CloudFront** (cms.defcon.run) | Serve media files via CDN, route admin traffic | S3 (media OAC), ALB (admin/API) | Existing -- no changes |
| **Branded Login Page** | DCR34-styled landing that redirects to OIDC | Strapi admin panel (app.tsx customization) | **NEW** (admin UI only) |
| **CMS Client** (in run.human) | Fetch content from workers via REST API | Strapi Workers (service discovery) | **NEW** |
| **nginx** (CMS) | TLS, region prefix stripping, admin route handling | Strapi app container | Existing -- no changes |

### Data Flow

**Content Creation (organizer writes via admin):**

1. Organizer navigates to `cms.defcon.run/use1/admin`
2. Branded login page redirects to `auth.defcon.run` OIDC flow
3. After auth, Strapi admin panel loads with event/route/POI content types
4. Organizer creates an Event, uploads photos (media field)
5. Strapi S3 upload provider writes photos to `s3://cms-media-bucket/use1/cms/uploads/photo.jpg`
6. Strapi stores media URL as `https://cms.defcon.run/use1/cms/uploads/photo.jpg` in SQLite
7. Organizer links Routes to Event (many-to-many relation via admin UI)
8. All data (content + relation junction tables) lives in SQLite
9. Litestream continuously replicates SQLite to S3

**Content Consumption (run.human reads via workers):**

1. run.human server-side (SSR or API route) needs event data
2. Calls `http://run-cms-worker.app-{region}-{site}.local:1337/api/events?populate=routes,routes.pois,gallery`
3. Worker reads from local SQLite (restored from S3 within last 5 min)
4. Returns JSON with event data, related routes, POIs, and media URLs
5. Media URLs point to `https://cms.defcon.run/{region}/cms/...` which CloudFront serves from S3
6. run.human renders the data for participants

## Content Type Schemas

### Event (`src/api/event/content-types/event/schema.json`)

```json
{
  "kind": "collectionType",
  "collectionName": "events",
  "info": {
    "singularName": "event",
    "pluralName": "events",
    "displayName": "Event",
    "description": "DCR34 scheduled activities"
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
    "eventType": {
      "type": "enumeration",
      "enum": ["run", "hike", "walk", "social", "workshop", "other"],
      "default": "run",
      "required": true
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
    "meetingPoint": {
      "type": "text"
    },
    "difficulty": {
      "type": "enumeration",
      "enum": ["easy", "moderate", "hard", "expert"],
      "default": "moderate"
    },
    "maxParticipants": {
      "type": "integer"
    },
    "gallery": {
      "type": "media",
      "multiple": true,
      "allowedTypes": ["images"]
    },
    "featuredImage": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "attachments": {
      "type": "media",
      "multiple": true,
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

### Route (`src/api/route/content-types/route/schema.json`)

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
    "routeType": {
      "type": "enumeration",
      "enum": ["running", "hiking", "walking", "cycling", "other"],
      "default": "running",
      "required": true
    },
    "distance": {
      "type": "decimal"
    },
    "elevationGain": {
      "type": "integer"
    },
    "estimatedDuration": {
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
      "allowedTypes": ["files"]
    },
    "featuredImage": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "events": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::event.event",
      "mappedBy": "routes"
    },
    "pois": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::point-of-interest.point-of-interest",
      "inversedBy": "routes"
    },
    "sortOrder": {
      "type": "integer",
      "default": 0
    }
  }
}
```

### Point of Interest (`src/api/point-of-interest/content-types/point-of-interest/schema.json`)

```json
{
  "kind": "collectionType",
  "collectionName": "points_of_interest",
  "info": {
    "singularName": "point-of-interest",
    "pluralName": "points-of-interest",
    "displayName": "Point of Interest",
    "description": "Standalone landmarks and waypoints"
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
    "poiType": {
      "type": "enumeration",
      "enum": ["water", "restroom", "aid-station", "viewpoint", "hazard", "parking", "start", "finish", "checkpoint", "landmark", "other"],
      "default": "landmark",
      "required": true
    },
    "latitude": {
      "type": "decimal",
      "required": true
    },
    "longitude": {
      "type": "decimal",
      "required": true
    },
    "photo": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "routes": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::route.route",
      "mappedBy": "pois"
    }
  }
}
```

## Relation Architecture

### Relation Topology

```
Event <--many-to-many--> Route <--many-to-many--> POI
  |                        |                        |
  | inversedBy: events     | inversedBy: routes     | mappedBy: pois
  | (Event owns join)      | (Route owns join)      | (Route owns join)
  |                        |                        |
  +--- gallery (media)     +--- gpxFiles (media)    +--- photo (media)
  +--- featuredImage       +--- featuredImage
  +--- attachments
```

### How Many-to-Many Works in SQLite

Strapi automatically creates junction tables for many-to-many relations. For `events <-> routes`, Strapi creates a table like `events_routes_lnk` with foreign keys to both sides. The `inversedBy`/`mappedBy` pair determines which side "owns" the relation:

- **`inversedBy` side (Event.routes)**: The owning side. Strapi stores the relation data. Admin UI shows a multi-select picker.
- **`mappedBy` side (Route.events)**: The inverse side. Strapi reads from the same junction table but does not create it. Admin UI shows a read-only list.

This means:
- To link a Route to an Event, edit the **Event** and select Routes
- To link a POI to a Route, edit the **Route** and select POIs
- Both sides are visible in the admin panel

### Master-Worker Implications for Relations

Relations are pure SQLite data (junction tables). They replicate identically via Litestream. No special handling needed:

1. **Writes**: Master creates/updates junction table rows when organizer links content
2. **Replication**: Litestream replicates the entire SQLite file (including junction tables) to S3
3. **Reads**: Workers restore from S3 and serve the same junction table data via REST API
4. **Population**: REST API `?populate=routes` resolves the junction table join on read

There is zero difference between how regular fields and relation fields replicate. It is all SQLite.

## Media Upload Architecture

### How Uploads Work in Master-Worker

**Upload flow (master only):**

1. Organizer uploads a photo via Strapi admin panel
2. Strapi's `@strapi/provider-upload-aws-s3` plugin handles the upload
3. Plugin uploads file to S3 bucket at path: `{rootPath}/{hash}_{filename}` where `rootPath = use1/cms`
4. Plugin stores the **CloudFront URL** in SQLite: `https://cms.defcon.run/use1/cms/{hash}_{filename}`
5. Litestream replicates SQLite (with the URL) to S3

**Read flow (workers + run.human):**

1. Worker's SQLite has the same CloudFront URLs (replicated from master)
2. REST API returns `{ url: "https://cms.defcon.run/use1/cms/{hash}_{filename}" }`
3. run.human renders `<img src="https://cms.defcon.run/use1/cms/{hash}_{filename}" />`
4. CloudFront serves the image from S3 via OAC (Origin Access Control)

**Key insight: Media files do NOT need to be in the regional worker's S3 bucket.** The URL stored in SQLite is a CloudFront URL. CloudFront is global. The master writes to `us-east-1` S3, and CloudFront serves it globally. S3 cross-region replication of the cms-media bucket provides redundancy but is not required for media serving since CloudFront can fetch from the origin region.

### Existing S3 Configuration (from plugins.ts)

```typescript
// rootPath determines the S3 prefix: use1/cms
const s3RootPath = `${regionShort}/cms`;

// baseUrl determines the URL stored in database
const cdnBaseUrl = `https://cms.${siteDomain}`;

// Result: uploads go to s3://bucket/use1/cms/file.jpg
// Database stores: https://cms.defcon.run/use1/cms/file.jpg
// CloudFront serves: https://cms.defcon.run/use1/cms/file.jpg (via S3 OAC)
```

This is already configured and working. No changes needed for new content types. Media fields in the schema.json files automatically use this upload provider.

### Media Types by Content Type

| Content Type | Field | Type | Allowed | Notes |
|-------------|-------|------|---------|-------|
| Event | gallery | multi-media | images | Photo galleries for event pages |
| Event | featuredImage | single media | images | Hero image for event cards |
| Event | attachments | multi-media | files, images | PDFs, maps, misc documents |
| Route | gpxFiles | multi-media | files | GPX track files (one per variant) |
| Route | featuredImage | single media | images | Route preview image |
| POI | photo | single media | images | Location photo |

## REST API Surface for run.human

### Strapi Auto-Generated REST Endpoints

When content types are defined via schema.json, Strapi automatically generates these REST API routes:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | List all published events |
| `/api/events/:documentId` | GET | Get single event by ID |
| `/api/routes` | GET | List all published routes |
| `/api/routes/:documentId` | GET | Get single route by ID |
| `/api/points-of-interest` | GET | List all published POIs |
| `/api/points-of-interest/:documentId` | GET | Get single POI by ID |

### Population Patterns for run.human

**Event list (dashboard/landing page):**
```
GET /api/events?populate=featuredImage&sort=startDate:asc&filters[startDate][$gte]=2026-08-07
```

**Event detail (event page with routes):**
```
GET /api/events/{id}?populate[routes][populate][0]=featuredImage&populate[routes][populate][1]=pois&populate[gallery]=*&populate[featuredImage]=*&populate[attachments]=*
```

**Route detail (route page with POIs):**
```
GET /api/routes/{id}?populate[pois][populate]=photo&populate[gpxFiles]=*&populate[featuredImage]=*
```

**All POIs for a map view:**
```
GET /api/points-of-interest?populate=photo&pagination[pageSize]=100
```

### Using qs Library for Clean Query Building

```typescript
import qs from "qs";

const query = qs.stringify({
  populate: {
    routes: {
      populate: {
        featuredImage: { fields: ["url", "width", "height", "alternativeText"] },
        pois: { populate: { photo: { fields: ["url", "alternativeText"] } } },
      },
    },
    gallery: { fields: ["url", "width", "height", "alternativeText"] },
    featuredImage: { fields: ["url", "width", "height", "alternativeText"] },
  },
  filters: {
    startDate: { $gte: "2026-08-07" },
  },
  sort: ["startDate:asc"],
}, { encodeValuesOnly: true });

const response = await fetch(`${CMS_WORKER_URL}/api/events?${query}`);
```

### CMS Client Pattern for run.human

Following the existing service-to-service pattern established by `quota-client.ts`:

```typescript
// New file: apps/run.human/webapp/src/lib/cms-client.ts

const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";

const CMS_WORKER_URL = process.env.CMS_INTERNAL_URL || (
  process.env.NODE_ENV === "development"
    ? "http://localhost:1337"
    : `http://run-cms-worker.app-${region}-${siteDomain.replace(/\./g, "-")}.local:1337`
);
```

**Key difference from quota-client**: CMS worker calls do NOT need `X-Internal-Secret`. Strapi's REST API permissions are role-based via the Users & Permissions plugin. For public content (events, routes, POIs), enable the `find` and `findOne` actions for the `Public` role in Strapi's admin settings. This is the standard Strapi pattern for headless CMS consumption.

### API Authentication Strategy

| Caller | Auth Needed | Method |
|--------|------------|--------|
| Strapi Admin Panel (organizers) | Yes | OIDC SSO + service claim validation |
| run.human server-side (SSR) | No* | Strapi Public role (find/findOne only) |
| run.human client-side (browser) | No | Never calls CMS directly -- goes through run.human server |

*Public role in Strapi is sufficient because:
- Workers have no ALB (internal service discovery only, no internet access)
- run.human is the only consumer
- Content is meant to be public (event info for participants)

If authenticated access to CMS API is ever needed (e.g., draft preview), use Strapi API tokens stored as SSM parameters and passed via `Authorization: Bearer {token}` header.

## Branded Login Page Architecture

### Problem

The current Strapi admin login page is the default Strapi form with email/password fields. Since OIDC SSO is the only auth method, the login form is confusing -- users should be redirected directly to auth.defcon.run.

### Solution: Admin Panel App Customization

Strapi 5 supports customizing the admin panel via `src/admin/app.ts`. The approach:

1. **Replace the auth logo** with DCR34 branding
2. **Auto-redirect** from the login page to the SSO endpoint
3. **Optionally override** the login page component to show a branded "Sign in with DCR34" button

**File: `src/admin/app.ts`**

```typescript
import AuthLogo from "./extensions/dcr34-logo.svg";

export default {
  config: {
    auth: {
      logo: AuthLogo,
    },
    locales: [],
    // Theme customization for DCR34 branding
    theme: {
      light: {
        colors: {
          primary100: "#f0f0ff",
          primary200: "#d9d9ff",
          primary500: "#6366f1",
          primary600: "#4f46e5",
          primary700: "#4338ca",
        },
      },
    },
  },
  bootstrap(app: any) {
    // Auto-redirect logic can be injected here if needed
  },
};
```

**The practical approach for OIDC-only login:**

The `strapi-plugin-sso` already adds an OIDC button to the login page. The simplest branded experience is:

1. Custom DCR34 logo on the auth page (via `auth.logo` config)
2. DCR34 color theme (via `theme` config)
3. A middleware or nginx rule that redirects `/use1/admin/auth/login` directly to the SSO OIDC endpoint, bypassing the Strapi login form entirely

**nginx approach (simplest, recommended):**

```nginx
# Redirect login page directly to OIDC SSO
location ~ ^/(use1|cac1)/admin/auth/login$ {
    return 302 /$1/strapi-plugin-sso/oidc;
}
```

This skips the Strapi login form and sends users straight to `auth.defcon.run`. After OIDC callback, the existing SSO extension (`strapi-server.ts`) handles token generation and redirects to the admin panel.

### Branded Login: Build Order Consideration

The nginx redirect approach requires zero Strapi code changes. The app.ts customization (logo + theme) is a nice-to-have that can be done independently. These are **fully independent** from content type work and should be their own phase.

## Patterns to Follow

### Pattern 1: Schema-Driven Content Types

**What:** Define content types entirely via `schema.json` files in `src/api/{name}/content-types/{name}/schema.json`. Strapi auto-generates REST API, admin UI, and database tables.

**When:** Always. This is how Strapi 5 works.

**Example directory structure for Event:**
```
src/api/event/
  content-types/
    event/
      schema.json          # Data model definition
      lifecycles.ts        # Optional: afterCreate/afterUpdate hooks
  controllers/
    event.ts               # Optional: custom controller logic
  routes/
    event.ts               # Optional: custom route config
  services/
    event.ts               # Optional: custom service logic
```

For basic CRUD with no custom logic, only `schema.json` is needed. The controller, routes, and services files are optional and only needed for customization.

### Pattern 2: Explicit Population (No populate=*)

**What:** Always specify exactly which relations and fields to populate in REST API calls. Never use `populate=*` in production.

**When:** Every REST API call from run.human.

**Why:** `populate=*` only goes one level deep and returns ALL fields including internal metadata. Explicit population is more efficient (less data transfer), more predictable (you control the shape), and avoids accidentally exposing sensitive fields.

```typescript
// BAD: populate=* (returns too much, unpredictable)
const res = await fetch(`${CMS_URL}/api/events?populate=*`);

// GOOD: explicit population with field selection
const query = qs.stringify({
  populate: {
    featuredImage: { fields: ["url", "width", "height", "alternativeText"] },
    routes: {
      fields: ["name", "slug", "routeType", "distance", "difficulty"],
      populate: {
        featuredImage: { fields: ["url", "alternativeText"] },
      },
    },
  },
  fields: ["title", "slug", "eventType", "startDate", "endDate", "location", "difficulty"],
}, { encodeValuesOnly: true });
```

### Pattern 3: Service Discovery for Internal Calls

**What:** run.human calls CMS workers via AWS Cloud Map service discovery, not through CloudFront/ALB.

**When:** All server-side CMS API calls from run.human.

**Why:** Lower latency (no CloudFront hop), stays in VPC, workers have no ALB (internal only).

```
http://run-cms-worker.app-{region}-{site}.local:1337/api/events
```

This follows the exact same pattern as `run-auth` service discovery already used by `quota-client.ts` and `services-validation.ts`.

### Pattern 4: Draft and Publish for Content Review

**What:** Use Strapi's built-in draft/publish system. Organizers create drafts, review, then publish. Only published content is served by the REST API to the Public role.

**When:** All content types. `draftAndPublish: true` in schema options.

**Why:** Prevents half-finished content from appearing on run.defcon.run. Organizers can prepare events days in advance and publish when ready.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Writing to Workers

**What:** Allowing any write operations (create, update, delete) on worker instances.

**Why bad:** Workers run on SQLite databases that are periodically overwritten by Litestream restore. Any writes would be lost on the next sync cycle (every 5 minutes). Additionally, SQLite does not support concurrent writes from multiple processes.

**Instead:** All content management happens through the master only. Workers are read-only API servers.

### Anti-Pattern 2: run.human Calling Master Instead of Workers

**What:** Configuring run.human to call the CMS master for content reads.

**Why bad:** The master is a single instance in us-east-1 only. It handles admin panel traffic and writes. Adding read traffic from run.human across all regions would increase latency (cross-region calls) and load on the single master.

**Instead:** run.human calls regional workers via service discovery. Workers exist in every region and can autoscale.

### Anti-Pattern 3: Client-Side CMS API Calls from Browser

**What:** Having the run.human React client call CMS API directly from the browser.

**Why bad:** Exposes CMS worker URLs (even internal ones need to be proxied), requires CORS configuration, creates a second hop pattern, and makes caching harder.

**Instead:** run.human server-side (Next.js SSR/RSC or API routes) calls CMS workers. The browser only talks to run.human.

### Anti-Pattern 4: Storing Media Locally Instead of S3

**What:** Using Strapi's default local upload provider instead of S3.

**Why bad:** Local filesystem is ephemeral on ECS Fargate containers. Files would be lost on task restart. Workers would not have access to files uploaded on master.

**Instead:** S3 upload provider with CloudFront CDN (already configured and working).

### Anti-Pattern 5: Using `populate=*` for Nested Relations

**What:** Using the wildcard population parameter for API calls that need deep relation data.

**Why bad:** `populate=*` only goes one level deep. For `Event -> Route -> POI`, the POIs would not be included. Also returns unnecessary metadata fields, increasing response size.

**Instead:** Use explicit nested population: `populate[routes][populate][0]=pois`.

## Worker Read-Only Constraint: Deep Dive

Strapi does not natively support read-only mode. The existing architecture handles this through a pragmatic workaround:

1. **Workers run normal Strapi** -- they are not configured as "read-only"
2. **SQLite is writable** on the worker (Strapi needs this for `strapi_core_store_settings` table updates at startup)
3. **Workers have no ALB** -- they are internal-only via service discovery, so no admin panel access from the internet
4. **Litestream sync overwrites the DB** every 5 minutes, resetting any accidental writes
5. **Workers lack OIDC/SSO config** -- no `STRAPI_OIDC_CLIENT_ID` or `STRAPI_OIDC_CLIENT_SECRET` env vars, so admin login is impossible even if someone reaches the admin panel URL

The net effect: workers are functionally read-only (no admin access, DB overwritten regularly) even though Strapi itself thinks it is a normal writable instance.

**Implication for content types:** None. The content type schemas are part of the Docker image (built at compile time). Both master and workers share the same image and thus the same content type definitions. The difference is only in which supervisord config runs (master replicates, worker restores).

## New Components Needed

| Component | Location | Type | Description |
|-----------|----------|------|-------------|
| Event schema | `src/api/event/content-types/event/schema.json` | New file | Event data model |
| Route schema | `src/api/route/content-types/route/schema.json` | New file | Route data model |
| POI schema | `src/api/point-of-interest/content-types/point-of-interest/schema.json` | New file | POI data model |
| CMS client lib | `apps/run.human/webapp/src/lib/cms-client.ts` | New file | Service discovery + fetch wrapper |
| CMS type defs | `apps/run.human/webapp/src/types/cms.ts` | New file | TypeScript interfaces for CMS responses |
| Admin app config | `apps/run.cms/app/src/admin/app.ts` | New file (rename from app.example) | Logo, theme, branding |
| DCR34 logo | `apps/run.cms/app/src/admin/extensions/dcr34-logo.svg` | New file | Branded auth logo |
| nginx login redirect | `apps/run.cms/nginx/nginx.conf` | Modified | Add OIDC auto-redirect rule |

## Existing Components Modified

| Component | Location | Change | Risk |
|-----------|----------|--------|------|
| nginx.conf | `apps/run.cms/nginx/nginx.conf` | Add login redirect to OIDC | Low -- single `location` block addition |
| run.human config | `apps/run.human/webapp/src/config/index.ts` | Add CMS worker URL | Low -- follows existing pattern |
| run.human service.hcl | `infra/terraform/live/site/services/run.human/service.hcl` | Add CMS_INTERNAL_URL env var | Low -- same pattern as AUTH_INTERNAL_URL |
| Strapi Public role | Admin UI setting | Enable find/findOne for event, route, POI | Low -- runtime config, not code |

## Build Order (Dependency-Driven)

```
Phase 1: Content Type Schemas (no dependencies)
  - event/schema.json
  - route/schema.json
  - point-of-interest/schema.json
  - Verify: strapi develop generates tables, admin UI shows content types
  - Verify: REST API endpoints respond (empty data)

Phase 2: Media + Relations Testing (depends on Phase 1)
  - Create test content with media uploads via admin panel
  - Create test many-to-many relations (link routes to events, POIs to routes)
  - Verify: S3 uploads work, CloudFront URLs resolve
  - Verify: REST API returns populated relations correctly
  - Verify: junction tables replicate via Litestream (test with worker)

Phase 3: Branded Login (independent of Phase 1-2)
  - app.ts with DCR34 logo and theme
  - nginx login redirect to OIDC
  - Verify: visiting /use1/admin/auth/login redirects to auth.defcon.run

Phase 4: run.human CMS Client (depends on Phase 1-2)
  - cms-client.ts with service discovery
  - TypeScript interfaces for CMS response shapes
  - Add CMS_INTERNAL_URL to run.human service.hcl
  - Verify: run.human can fetch events from CMS worker via service discovery

Phase 5: Public Role Permissions + Deploy (depends on Phase 1-4)
  - Enable find/findOne for Public role on all content types
  - Deploy CMS (master + workers)
  - Deploy run.human (with CMS client)
  - Verify: end-to-end flow works in production
```

Phase 1 and Phase 3 can run in parallel. Phase 4 can start once Phase 1 content types are defined (does not need real data). Phase 2 is a testing/validation phase that confirms the architecture works before building the run.human integration.

## Scalability Considerations

| Concern | Current (organizer-only) | At event (1000+ participants) | Notes |
|---------|-------------------------|-------------------------------|-------|
| Write load | 1-5 organizers editing | Same -- organizers only write | Master is adequate |
| Read load | Low (testing) | Moderate (run.human SSR) | Workers autoscale 1-3 per region |
| Media serving | Low | High (event images on every page load) | CloudFront handles all media serving |
| Replication lag | 5 min sync interval | 5 min sync interval | Acceptable -- content changes infrequently during event |
| SQLite size | Minimal (<10MB) | Still small (text content + URLs, no binary data) | Binary data is in S3, not SQLite |

The architecture is well-suited to this use case: low write volume (organizers only), moderate read volume (participants via run.human), and high media volume (offloaded to CloudFront/S3).

## Sources

- [Strapi 5 Content-Type Builder](https://docs.strapi.io/cms/features/content-type-builder) -- Admin UI for content types
- [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models) -- Schema.json format, attribute types, relations
- [Strapi 5 Relations REST API](https://docs.strapi.io/cms/api/rest/relations) -- connect/disconnect/set operations
- [Strapi 5 Populate and Select](https://docs.strapi.io/cms/api/rest/populate-select) -- Query parameter syntax
- [Strapi 5 Understanding Populate](https://docs.strapi.io/cms/api/rest/guides/understanding-populate) -- Deep population patterns
- [Strapi 5 Admin Panel Customization](https://docs.strapi.io/cms/admin-panel-customization) -- app.ts, logo, theme
- [Strapi 5 Amazon S3 Provider](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3) -- S3 upload configuration
- [Strapi 5 REST API Reference](https://docs.strapi.io/cms/api/rest) -- Full REST API documentation
- [Strapi 5 Routes Documentation](https://docs.strapi.io/cms/backend-customization/routes) -- Custom route configuration
- [Strapi 5 SSO Configuration](https://docs.strapi.io/cms/configurations/guides/configure-sso) -- Single Sign-On setup
- [Strapi Forum: Read-Only DB Replica](https://forum.strapi.io/t/starting-strapi-api-on-read-only-db-replica/28872) -- Limitations of read-only Strapi
- [strapi-plugin-sso GitHub](https://github.com/yasudacloud/strapi-plugin-sso) -- OIDC SSO plugin
- Existing codebase: `apps/run.cms/` -- All configuration, middleware, extensions verified from source
- Existing codebase: `apps/run.human/webapp/src/lib/quota-client.ts` -- Service discovery pattern reference
- Existing codebase: `infra/terraform/live/site/services/run.cms/service.hcl` -- Infrastructure configuration reference
