---
phase: 05-infrastructure-hardening-content-type-schemas
plan: 02
subsystem: cms
tags: [strapi, schema, content-types, coordinates, geolocation, gpx, media]

# Dependency graph
requires:
  - phase: 05-infrastructure-hardening-content-type-schemas
    provides: "Strapi 5 CMS app with health endpoint (plan 01)"
provides:
  - "Shared coordinates component (shared.coordinates) with lat/lng validation"
  - "Event collection type with blocks description, datetime, media fields"
  - "Route collection type with GPX upload, map styling, start/end coordinates"
  - "Point of Interest collection type with 12 DEF CON POI types"
affects: [06-content-type-relations, 07-branded-login, run-human-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: [strapi-schema-json, shared-component-reuse, uid-slug-targetField]

key-files:
  created:
    - apps/run.cms/app/src/components/shared/coordinates.json
    - apps/run.cms/app/src/api/event/content-types/event/schema.json
    - apps/run.cms/app/src/api/route/content-types/route/schema.json
    - apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json
  modified: []

key-decisions:
  - "POI description uses text type (not blocks) since POI descriptions are simpler"
  - "Map styling as inline Route fields (not a separate component) since only Route uses them"
  - "No difficulty field on Route — computed at display time from distance/elevation/GPX data"

patterns-established:
  - "Shared components at src/components/{category}/{name}.json for reuse across content types"
  - "All content types use uid slug with targetField and required: true"
  - "All collection types enable draftAndPublish: true"
  - "Coordinates validated with min/max (-90/90 lat, -180/180 lng)"

requirements-completed: [SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-07]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 5 Plan 2: Content Type Schemas Summary

**Strapi 5 schemas for Event, Route, and Point of Interest with shared GPS coordinates component, blocks editor, GPX upload, map styling, and 12 DEF CON POI types**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T15:56:24Z
- **Completed:** 2026-03-02T15:58:31Z
- **Tasks:** 3
- **Files created:** 4

## Accomplishments
- Shared coordinates component with latitude (-90/90) and longitude (-180/180) min/max validation, reused by all three content types
- Event schema with blocks rich text, datetime fields, media gallery, attachments, and component-based location coordinates
- Route schema with route type enum, distance/elevation/duration, GPX multi-upload, start/end coordinates, and inline map styling (color/weight/opacity)
- Point of Interest schema with required coordinates, 12 DEF CON-flavored POI types, marker image, and photo

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared coordinates component and Event schema** - `bf59898` (feat)
2. **Task 2: Create Route schema** - `ca4aa30` (feat)
3. **Task 3: Create Point of Interest schema** - `4482856` (feat)

## Files Created/Modified
- `apps/run.cms/app/src/components/shared/coordinates.json` - Reusable GPS lat/lng pair component with min/max validation
- `apps/run.cms/app/src/api/event/content-types/event/schema.json` - Event collection type with all DCR34 fields
- `apps/run.cms/app/src/api/route/content-types/route/schema.json` - Route collection type with GPX, map styling, coordinates
- `apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json` - POI collection type with 12 DEF CON types

## Decisions Made
- POI description uses `text` type (not `blocks`) since POI descriptions are simpler text, not rich formatted content
- Map styling implemented as inline fields on Route (mapColor, mapWeight, mapOpacity) rather than a separate component, since only Route uses them
- No difficulty field on Route per user decision — computed at display time from distance/elevation/GPX data

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three content types and shared coordinates component are ready for Strapi to auto-generate REST API, admin UI, and database tables on next startup
- Phase 6 can proceed to add relations between Event, Route, and POI content types
- Phase 7 (Branded Login) can proceed independently

## Self-Check: PASSED

- All 4 schema files exist at expected paths
- All 3 task commits verified (bf59898, ca4aa30, 4482856)
- All 10 verification checks passed programmatically

---
*Phase: 05-infrastructure-hardening-content-type-schemas*
*Completed: 2026-03-02*
