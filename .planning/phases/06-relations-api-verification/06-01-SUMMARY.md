---
phase: 06-relations-api-verification
plan: 01
subsystem: cms
tags: [strapi, relations, many-to-many, enumeration, permissions, bootstrap]

# Dependency graph
requires:
  - phase: 05-infrastructure-hardening-content-type-schemas
    provides: Event, Route, and POI content type schemas with base fields
provides:
  - Bidirectional many-to-many Event<->Route relation
  - Bidirectional many-to-many Route<->POI relation
  - eventType enumeration on Event (run, social, swag-swap, workshop, ceremony, meetup)
  - Public role read-only API access (find + findOne) for all three content types
affects: [08-frontend-integration, 06-02-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [inversedBy/mappedBy ownership pairing, plugin store idempotency guard]

key-files:
  created: []
  modified:
    - apps/run.cms/app/src/api/event/content-types/event/schema.json
    - apps/run.cms/app/src/api/route/content-types/route/schema.json
    - apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json
    - apps/run.cms/app/src/index.ts

key-decisions:
  - "Event owns Event<->Route relation (inversedBy), Route is inverse (mappedBy)"
  - "Route owns Route<->POI relation (inversedBy), POI is inverse (mappedBy)"
  - "Plugin store key publicPermissionsConfigured used for bootstrap idempotency"

patterns-established:
  - "inversedBy on owning side, mappedBy on inverse side for bidirectional many-to-many"
  - "Bootstrap permission setup via plugin store guard for one-time execution"

requirements-completed: [SCHM-05, SCHM-06, API-01]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 06 Plan 01: Relations & API Permissions Summary

**Bidirectional many-to-many relations (Event<->Route, Route<->POI) with eventType enum and idempotent public read-only API bootstrap**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T17:12:29Z
- **Completed:** 2026-03-02T17:15:18Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Event<->Route bidirectional many-to-many with correct inversedBy/mappedBy pairing (single join table)
- Route<->POI bidirectional many-to-many with correct inversedBy/mappedBy pairing (single join table)
- eventType enumeration on Event schema (run, social, swag-swap, workshop, ceremony, meetup) for type-based filtering
- Bootstrap function grants Public role find + findOne on events, routes, and points-of-interest APIs
- Idempotent permission setup via plugin store guard (runs once, skipped on subsequent boots)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add eventType enum and relations to all three content type schemas** - `70a99b5` (feat)
2. **Task 2: Add idempotent public permission bootstrap to src/index.ts** - `eb0bf44` (feat)

## Files Created/Modified
- `apps/run.cms/app/src/api/event/content-types/event/schema.json` - Added eventType enum and routes relation (inversedBy: events)
- `apps/run.cms/app/src/api/route/content-types/route/schema.json` - Added events relation (mappedBy: routes) and pointsOfInterest relation (inversedBy: routes)
- `apps/run.cms/app/src/api/point-of-interest/content-types/point-of-interest/schema.json` - Added routes relation (mappedBy: pointsOfInterest)
- `apps/run.cms/app/src/index.ts` - Added ensurePublicPermissions helper with plugin store idempotency guard

## Decisions Made
- Event is the owning side of Event<->Route (uses inversedBy) -- follows convention that the "parent" entity owns the relation
- Route is the owning side of Route<->POI (uses inversedBy) -- Route is the natural container for POIs along it
- Plugin store key `publicPermissionsConfigured` for idempotency -- standard Strapi pattern, avoids re-running permission setup on every restart
- Permission errors caught and logged without crashing Strapi -- permission setup failure should not block CMS startup

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All relations wired and ready for Phase 06-02 verification testing
- Public API endpoints will respond to unauthenticated GET requests once Strapi boots with these changes
- Phase 8 (frontend integration) can use `?populate=routes` and `?populate=pointsOfInterest` for nested data

## Self-Check: PASSED

All 4 modified files verified on disk. Both task commits (70a99b5, eb0bf44) found in git log.

---
*Phase: 06-relations-api-verification*
*Completed: 2026-03-02*
