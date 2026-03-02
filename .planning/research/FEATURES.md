# Feature Landscape: CMS Content Types for DEF CON Run 34

**Domain:** Event/route/POI content management for an organized running/hiking event at DEF CON 34
**Researched:** 2026-03-02
**Confidence:** HIGH (Strapi 5 schema patterns verified via official docs; domain model derived from project context, GPX standards, and real-world race event platforms)

## Table Stakes

Features organizers expect from a CMS managing running/hiking events. Missing any of these makes the admin panel feel incomplete or forces workarounds. These are baseline expectations for any event-with-routes CMS.

### Event Content Type

| Feature | Why Expected | Complexity | Strapi Field | Notes |
|---------|--------------|------------|--------------|-------|
| **Title** | Every event needs a name. "Day 1 Morning Run", "Day 2 Swag Swap". | Low | `string`, required, maxLength 200 | Used as display name everywhere. |
| **Slug** | URL-friendly identifier for API consumption and deep linking. | Low | `uid`, targetField: title | Auto-generated from title, editable. run.human uses this for routing. |
| **Description** | Rich text body explaining the event: what to expect, what to bring, safety notes. | Med | `blocks` (Rich Text Blocks) | Use `blocks` not `richtext` -- Blocks provides live rendering, embedded images, structured JSON output. Pair with `@strapi/blocks-react-renderer` in run.human. |
| **Short description** | One-liner for cards, list views, notifications. | Low | `text`, maxLength 300 | Distinct from description -- avoids truncation hacks on the frontend. |
| **Start date/time** | When the event begins. Critical for scheduling, countdown timers, sort order. | Low | `datetime`, required | Store in UTC. run.human converts to Las Vegas local time (America/Los_Angeles). |
| **End date/time** | When the event ends. Duration is derived (end - start). | Low | `datetime` | Optional -- some events are open-ended (e.g., "Swag Swap until supplies last"). |
| **Location name** | Human-readable meeting point. "LVCC West Hall Entrance", "Flamingo Pool Deck". | Low | `string` | Free text, not a formal address. DEF CON venues are convention centers, not street addresses. |
| **Location coordinates** | Lat/lng for the meeting point. Powers map pins in run.human. | Low | Component: `shared.coordinates` (lat: float, lng: float) | Use a reusable component, not inline fields. Same component reused by POI content type. |
| **Cover image** | Hero image for event cards and detail pages. | Low | `media`, single | Standard Strapi media field. Served via CloudFront from S3. |
| **Photo gallery** | Multiple photos showing the route, venue, past events. | Low | `media`, multiple: true | Strapi handles multi-upload natively. Organizers drag-drop photos in admin. |
| **Status** | Published/draft lifecycle for controlling visibility. | Low | Built-in `draftAndPublish: true` | Strapi 5 draft/publish. Events stay draft until organizer clicks Publish. REST API returns only published by default, draft requires `?status=draft`. |
| **Routes relation** | Link to associated Route entries. An event can have multiple routes (5K, 10K, fun walk). | Med | `relation: manyToMany`, target: route, inversedBy: events | Bidirectional many-to-many. A route can also be reused across events (e.g., same 5K course on Day 1 and Day 3). |
| **Sort order** | Controls display ordering on run.human event list. | Low | `integer`, default: 0 | Simple integer sort. Organizers reorder events without changing dates. |

### Route Content Type

| Feature | Why Expected | Complexity | Strapi Field | Notes |
|---------|--------------|------------|--------------|-------|
| **Name** | Route title. "5K Loop - LVCC to Sphere", "Recovery Walk". | Low | `string`, required, maxLength 200 | |
| **Slug** | URL-friendly identifier. | Low | `uid`, targetField: name | |
| **Description** | Rich text with route details: terrain, difficulty, elevation notes, safety warnings. | Med | `blocks` | |
| **Short description** | Card-level summary. | Low | `text`, maxLength 300 | |
| **Route type** | Classification: point-to-point, loop, out-and-back. | Low | `enumeration`, enum: [point_to_point, loop, out_and_back] | Displayed as badge/icon in run.human. Affects how start/end points are rendered. |
| **Distance** | Route distance in miles (primary) with meters stored for precision. | Low | `decimal` | Store in meters, display in miles. Derived from GPX track data but editable (GPX-derived distance may differ from official race distance). |
| **Elevation gain** | Total ascent in meters. | Low | `decimal` | Important for Las Vegas -- participants need to know if it is flat or hilly. |
| **Difficulty** | Easy / Moderate / Hard rating. | Low | `enumeration`, enum: [easy, moderate, hard] | Displayed as color-coded badge in run.human. |
| **GPX files** | One or more GPX files defining the track. This is the core asset. | Med | `media`, multiple: true, allowedTypes: [files] | Store as media uploads to S3. run.human and run.gpx can download these. Strapi media library supports any file type -- GPX is just XML with .gpx extension. |
| **Start point** | Coordinates of route start. | Low | Component: `shared.coordinates` | Separate from GPX data for quick map rendering without parsing GPX. |
| **End point** | Coordinates of route end. | Low | Component: `shared.coordinates` | For loops, start == end. Frontend can detect this. |
| **Cover image** | Route preview image (map screenshot, aerial photo). | Low | `media`, single | |
| **Events relation** | Bidirectional link back to events. | Med | `relation: manyToMany`, target: event, mappedBy: routes | Inverse side of event->routes relation. |
| **Points of interest** | Ordered list of POIs along this route. | Med | `relation: manyToMany`, target: poi, inversedBy: routes | Aid stations, photo ops, checkpoints. Many-to-many because POIs can appear on multiple routes. |
| **Sort order** | Display ordering within an event's route list. | Low | `integer`, default: 0 | |
| **Estimated duration** | Expected completion time in minutes. | Low | `integer` | "~45 minutes for walkers, ~25 minutes for runners". Display as human-readable range in run.human. |

### Point of Interest Content Type

| Feature | Why Expected | Complexity | Strapi Field | Notes |
|---------|--------------|------------|--------------|-------|
| **Name** | POI label. "Water Station 1", "The Sphere Photo Op", "Aid Station - Flamingo". | Low | `string`, required, maxLength 200 | |
| **Slug** | URL-friendly identifier. | Low | `uid`, targetField: name | |
| **Description** | What is at this location. Rich text with details about the POI. | Low | `blocks` | |
| **Coordinates** | Lat/lng of the POI. | Low | Component: `shared.coordinates`, required | The defining attribute of a POI. |
| **POI type** | Classification: water_station, aid_station, photo_op, checkpoint, landmark, start, finish, hazard, restroom. | Low | `enumeration`, enum: [water_station, aid_station, photo_op, checkpoint, landmark, start, finish, hazard, restroom] | Drives icon selection on the map in run.human. Extensible later via Strapi admin. |
| **Icon / marker image** | Optional custom marker image for the map. | Low | `media`, single | Falls back to type-based default icon if not set. |
| **Photo** | Photo of the location for identification. | Low | `media`, single | Helps runners identify the POI when approaching. |
| **Routes relation** | Bidirectional link to routes this POI appears on. | Med | `relation: manyToMany`, target: route, mappedBy: pois | Inverse side of route->pois relation. |
| **Sort order** | Order of POI along a route (1st checkpoint, 2nd checkpoint, etc.). | Low | `integer`, default: 0 | Note: ordering is route-specific but Strapi many-to-many does not support per-relation ordering natively. Use sort_order as a global hint and rely on route-level ordering in run.human. |

### Reusable Component: shared.coordinates

| Field | Type | Notes |
|-------|------|-------|
| **latitude** | `float`, required | Range: -90 to 90. Las Vegas is approximately 36.17N. |
| **longitude** | `float`, required | Range: -180 to 180. Las Vegas is approximately -115.14W. |

This component lives at `src/components/shared/coordinates/schema.json` and is referenced by Event (location), Route (start_point, end_point), and POI (coordinates). Using a component instead of inline float fields ensures consistent naming and validation across all content types.

### Branded OIDC Login Page

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Custom admin login UI** | The default Strapi login page is generic. Organizers should see DCR34 branding when logging in via OIDC. | Med | Strapi 5 supports admin panel customization via `src/admin/app.tsx`. Override the login page component to show DCR34 logo, colors, and a single "Sign in with DEF CON Run" button that triggers the OIDC flow. Hide the email/password fields since all auth goes through auth.defcon.run. |
| **OIDC-only login** | No local email/password login. All users authenticate via auth.defcon.run with `cms` service claim. | Low | Already configured via strapi-plugin-sso. The branded page just needs to surface the SSO button prominently and hide default fields. |

### REST API for run.human

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Public read API** | run.human fetches events, routes, POIs via REST API. No authentication required for published content. | Low | Strapi 5 REST API at `/api/events`, `/api/routes`, `/api/pois`. Configure permissions: Public role gets `find` and `findOne` on all three content types. |
| **Populate support** | Single API call returns event with its routes, routes with their POIs, including media URLs. | Med | Strapi 5 `?populate=*` for one level, or nested populate: `?populate[routes][populate][0]=pois&populate[routes][populate][1]=gpx_files`. run.human should use the `qs` library to build populate queries. |
| **Field selection** | Return only needed fields to reduce payload size. | Low | `?fields[0]=title&fields[1]=slug&fields[2]=start_datetime`. Important for list views that do not need full descriptions. |
| **Filtering and sorting** | Filter events by date range, sort by start_datetime or sort_order. | Low | Strapi 5 built-in: `?filters[start_datetime][$gte]=2026-08-06&sort=sort_order:asc`. |
| **Draft filtering** | Published-only by default. Organizers can preview drafts with explicit `?status=draft`. | Low | Strapi 5 built-in behavior. run.human always fetches published. CMS admin panel shows both. |

## Differentiators

Features that elevate this CMS beyond a basic event listing. Not expected by organizers but highly valuable for the DEF CON Run experience.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **File attachments on events** | Events can have downloadable files: GPX bundles, PDF maps, waivers, video content. Goes beyond just photos. | Low | `media`, multiple: true on Event. Strapi media library handles any file type. Separate from photo gallery -- this is for downloads, not display. |
| **GPX file metadata display** | Show distance, elevation, track count extracted from uploaded GPX files as read-only fields in the admin. | High | Requires custom Strapi lifecycle hook or plugin to parse GPX XML on upload and populate derived fields. Defer to v1.2 -- for v1.1, organizers manually enter distance/elevation. |
| **Route preview map in admin** | Inline map widget in Strapi admin showing the GPX track on a map. | High | Requires custom Strapi field plugin with Mapbox/Leaflet. Significant scope. Defer -- organizers use gpx.defcon.run for visual editing and just upload the final GPX to CMS. |
| **Event countdown/status** | Auto-computed event status: upcoming, active, completed based on current time vs start/end datetime. | Med | Computed in run.human at render time, not stored in CMS. CMS just stores the datetimes. No Strapi customization needed. |
| **Multilingual content** | Strapi 5 has built-in i18n plugin. Could support multiple languages. | Med | SKIP for v1.1. DEF CON is English-primary. i18n adds complexity to every content type and API query. |
| **Content versioning / audit trail** | Track who changed what and when. Useful for multi-organizer teams. | Low | Strapi 5 has built-in audit logs for admin actions. Draft/publish provides basic versioning. No custom work needed for basic coverage. |
| **Webhook notifications** | Notify run.human when content changes for cache invalidation. | Med | Strapi 5 webhooks built-in. Configure webhook to hit a run.human API endpoint on event/route/POI publish. Useful for ISR/revalidation in Next.js. Consider for v1.1 if run.human caching is implemented. |

## Anti-Features

Features to explicitly NOT build. Each would add complexity disproportionate to the DCR34 use case.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Live timing / splits** | Race timing is a specialized domain with hardware (RFID mats, transponders). Building a timing system inside a CMS is absurd scope. Race event platforms like RACE RESULT exist for this. | DCR34 is a fun run, not a competitive race. No timing needed. If timing is ever wanted, use a dedicated race timing platform and link results externally. |
| **Participant registration via CMS** | Registration belongs in run.human (already has user accounts, OIDC, DynamoDB). CMS is for content management, not transactional user data. | run.human handles registration. CMS provides event info that run.human renders. Clean separation. |
| **Real-time participant tracking** | Meshtastic mesh provides location data. Building a tracking dashboard in Strapi is wrong tool for the job. | Participant tracking is a separate feature built on Meshtastic MQTT data in run.human, not CMS content. |
| **Route editing in CMS admin** | GPX editing is a complex spatial UI. gpx.defcon.run (built on gpx-studio) already does this beautifully. | Organizers edit routes in gpx.defcon.run, export GPX files, upload finished GPX to CMS. CMS is storage and API, not an editor. |
| **Automatic geocoding** | Converting addresses to coordinates or vice versa. Adds API dependencies (Google Maps, Mapbox) for marginal value. | Organizers enter lat/lng manually (or copy from gpx.defcon.run / Google Maps). DEF CON venues are well-known; coordinates rarely change. |
| **Complex RBAC per content type** | Different permissions for events vs routes vs POIs. Overkill for a small organizer team (3-5 people). | All CMS users with `cms` service claim get full access to all content types. Strapi admin roles can be refined later if needed. |
| **GraphQL API** | Adds a plugin dependency and doubles the API surface. REST with populate/select is sufficient for run.human's needs. | REST API only. Strapi 5 REST with qs-built queries handles all data fetching patterns. |
| **SEO fields** | Meta descriptions, OpenGraph images, structured data. CMS content is consumed by run.human internally, not crawled by search engines. | run.human controls its own SEO. CMS content has no direct public web presence. |
| **Comments / social features** | Comments on events or routes. Out of scope for an organizer-only CMS. | Social features belong in run.human or Discord, not the CMS admin panel. |
| **Recurring event scheduling** | RRULE patterns for repeating events. DCR34 is a 4-day conference; each event is manually created. | Create each event individually. There are only ~10-20 events total. Manual is fine. |
| **i18n / localization** | Multi-language support adds complexity to every content type definition, every API query, and the admin workflow. | English only. DEF CON is a US-based conference. |

## Feature Dependencies

```
shared.coordinates Component
  (no dependencies -- created first, used by Event, Route, POI)

Event Content Type
  -> depends on: shared.coordinates component (location)
  -> relation to: Route (manyToMany, Event owns inversedBy)

Route Content Type
  -> depends on: shared.coordinates component (start_point, end_point)
  -> relation to: Event (manyToMany, mappedBy from Event)
  -> relation to: POI (manyToMany, Route owns inversedBy)

POI Content Type
  -> depends on: shared.coordinates component (coordinates)
  -> relation to: Route (manyToMany, mappedBy from Route)

Branded Login Page
  -> depends on: existing strapi-plugin-sso OIDC config (already working)
  -> no content type dependencies

REST API Permissions
  -> depends on: all three content types being defined
  -> configure after content types exist

run.human Integration
  -> depends on: REST API permissions configured
  -> depends on: at least one published event with routes and POIs
```

**Build order:** shared.coordinates -> Event -> Route -> POI -> Permissions -> Branded Login -> run.human integration

The component must exist before any content type that references it. Event should be created first because it is the top-level organizing unit. Route references Event via mappedBy. POI references Route via mappedBy. Relations must be created on both sides simultaneously in practice (Strapi creates both schema files when you define a bidirectional relation via the Content-Type Builder).

## MVP Recommendation

### Must Have (v1.1 release)

1. **shared.coordinates component** -- Foundation for all geo fields
2. **Event content type** -- All table stakes fields. The organizing unit.
3. **Route content type** -- All table stakes fields. Links to events.
4. **POI content type** -- All table stakes fields. Links to routes.
5. **File attachments on events** -- GPX bundles and downloads
6. **REST API permissions** -- Public read for all content types
7. **Branded OIDC login page** -- DCR34 branding on admin panel

### Should Have (v1.1 if time permits)

1. **Webhook for content changes** -- Cache invalidation in run.human
2. **Populate query patterns** -- Documented and tested qs-based queries for run.human

### Defer to Later

- GPX file metadata extraction (v1.2 -- needs custom Strapi lifecycle hook)
- Route preview map in admin (v1.2+ -- needs custom Strapi field plugin)
- i18n, GraphQL, complex RBAC, SEO fields (likely never for this project)

**Rationale:** The v1.1 goal is "organizers can manage DCR34 events, routes, and POIs." This means three content types with their relations, the shared coordinate component, file upload support, public REST API, and a branded login experience. Everything else is optimization or future scope.

## Strapi 5 Schema Reference (Actionable)

### File Structure

```
src/
  api/
    event/
      content-types/
        event/
          schema.json          # Event content type definition
      controllers/
        event.ts               # Auto-generated, customizable
      routes/
        event.ts               # Auto-generated, customizable
      services/
        event.ts               # Auto-generated, customizable
    route/
      content-types/
        route/
          schema.json          # Route content type definition
      controllers/
        route.ts
      routes/
        route.ts
      services/
        route.ts
    poi/
      content-types/
        poi/
          schema.json          # POI content type definition
      controllers/
        poi.ts
      routes/
        poi.ts
      services/
        poi.ts
  components/
    shared/
      coordinates.json         # Reusable coordinates component
```

### Schema Skeletons

**shared/coordinates.json:**
```json
{
  "collectionName": "components_shared_coordinates",
  "info": {
    "displayName": "Coordinates",
    "description": "Latitude/longitude coordinate pair"
  },
  "attributes": {
    "latitude": {
      "type": "float",
      "required": true,
      "min": -90,
      "max": 90
    },
    "longitude": {
      "type": "float",
      "required": true,
      "min": -180,
      "max": 180
    }
  }
}
```

**event/schema.json:**
```json
{
  "kind": "collectionType",
  "collectionName": "events",
  "info": {
    "singularName": "event",
    "pluralName": "events",
    "displayName": "Event",
    "description": "Scheduled activities for DEF CON Run 34"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true,
      "maxLength": 200
    },
    "slug": {
      "type": "uid",
      "targetField": "title"
    },
    "description": {
      "type": "blocks"
    },
    "short_description": {
      "type": "text",
      "maxLength": 300
    },
    "start_datetime": {
      "type": "datetime",
      "required": true
    },
    "end_datetime": {
      "type": "datetime"
    },
    "location_name": {
      "type": "string",
      "maxLength": 300
    },
    "location": {
      "type": "component",
      "repeatable": false,
      "component": "shared.coordinates"
    },
    "cover_image": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "photo_gallery": {
      "type": "media",
      "multiple": true,
      "allowedTypes": ["images"]
    },
    "attachments": {
      "type": "media",
      "multiple": true
    },
    "routes": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::route.route",
      "inversedBy": "events"
    },
    "sort_order": {
      "type": "integer",
      "default": 0
    }
  }
}
```

**route/schema.json:**
```json
{
  "kind": "collectionType",
  "collectionName": "routes",
  "info": {
    "singularName": "route",
    "pluralName": "routes",
    "displayName": "Route",
    "description": "Navigational paths for DEF CON Run 34 events"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "name": {
      "type": "string",
      "required": true,
      "maxLength": 200
    },
    "slug": {
      "type": "uid",
      "targetField": "name"
    },
    "description": {
      "type": "blocks"
    },
    "short_description": {
      "type": "text",
      "maxLength": 300
    },
    "route_type": {
      "type": "enumeration",
      "enum": ["point_to_point", "loop", "out_and_back"],
      "required": true
    },
    "distance_meters": {
      "type": "decimal"
    },
    "elevation_gain_meters": {
      "type": "decimal"
    },
    "difficulty": {
      "type": "enumeration",
      "enum": ["easy", "moderate", "hard"]
    },
    "estimated_duration_minutes": {
      "type": "integer"
    },
    "gpx_files": {
      "type": "media",
      "multiple": true,
      "allowedTypes": ["files"]
    },
    "start_point": {
      "type": "component",
      "repeatable": false,
      "component": "shared.coordinates"
    },
    "end_point": {
      "type": "component",
      "repeatable": false,
      "component": "shared.coordinates"
    },
    "cover_image": {
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
      "target": "api::poi.poi",
      "inversedBy": "routes"
    },
    "sort_order": {
      "type": "integer",
      "default": 0
    }
  }
}
```

**poi/schema.json:**
```json
{
  "kind": "collectionType",
  "collectionName": "pois",
  "info": {
    "singularName": "poi",
    "pluralName": "pois",
    "displayName": "Point of Interest",
    "description": "Landmarks, checkpoints, and aid stations along routes"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "name": {
      "type": "string",
      "required": true,
      "maxLength": 200
    },
    "slug": {
      "type": "uid",
      "targetField": "name"
    },
    "description": {
      "type": "blocks"
    },
    "coordinates": {
      "type": "component",
      "repeatable": false,
      "component": "shared.coordinates",
      "required": true
    },
    "poi_type": {
      "type": "enumeration",
      "enum": [
        "water_station",
        "aid_station",
        "photo_op",
        "checkpoint",
        "landmark",
        "start",
        "finish",
        "hazard",
        "restroom"
      ],
      "required": true
    },
    "marker_image": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
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
    },
    "sort_order": {
      "type": "integer",
      "default": 0
    }
  }
}
```

## Sources

- [Strapi 5 Models Documentation](https://docs.strapi.io/cms/backend-customization/models) -- Schema.json structure, field types, relation syntax (HIGH confidence)
- [Strapi 5 Relations REST API](https://docs.strapi.io/cms/api/rest/relations) -- Connect/disconnect/set operations for many-to-many (HIGH confidence)
- [Strapi 5 Content-Type Builder](https://docs.strapi.io/cms/features/content-type-builder) -- Field type catalog, enumeration configuration (HIGH confidence)
- [Strapi 5 Populate & Select](https://docs.strapi.io/cms/api/rest/populate-select) -- Query parameter syntax for nested relations (HIGH confidence)
- [Strapi 5 Understanding Populate](https://docs.strapi.io/cms/api/rest/guides/understanding-populate) -- Deep populate patterns (HIGH confidence)
- [Strapi 5 Draft & Publish](https://docs.strapi.io/cms/features/draft-and-publish) -- Status parameter, publish workflow (HIGH confidence)
- [Strapi 5 Media Library](https://docs.strapi.io/cms/features/media-library) -- Multi-file uploads, allowed types (HIGH confidence)
- [Strapi 5 Upload API](https://docs.strapi.io/cms/api/rest/upload) -- File upload via REST (HIGH confidence)
- [Strapi Rich Text Blocks + Next.js](https://strapi.io/blog/integrating-strapi-s-new-rich-text-block-editor-with-next-js-a-step-by-step-guide) -- Blocks renderer integration pattern (MEDIUM confidence)
- [Strapi GeoData Plugin](https://market.strapi.io/plugins/strapi-geodata) -- Geo field handling patterns in Strapi 5 (MEDIUM confidence -- plugin approach, we use component instead)
- [RACE RESULT Timing Software](https://www.raceresult.com/en/software/index) -- Race event platform features reference (MEDIUM confidence -- informed anti-features)
- [Strapi Event Management Blog](https://strapi.io/blog/build-an-event-management-website) -- Event CMS patterns with Strapi (MEDIUM confidence)
- [GPX 1.1 Schema Types](https://www.topografix.com/gpx.asp) -- GPX file structure: tracks, routes, waypoints (HIGH confidence -- standard)
- [GPX Studio Source](https://github.com/gpxstudio/gpx-studio) -- GPX type definitions used in run.gpx (HIGH confidence -- direct codebase analysis)
