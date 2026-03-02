---
phase: 03-config-engine-server-api
plan: 01
subsystem: api
tags: [meshtastic, electrodb, dynamodb, mqtt, next-api-route, device-config]

# Dependency graph
requires:
  - phase: 01-app-scaffold-device-picker
    provides: "Next.js flash app scaffold with Auth.js OIDC auth"
  - phase: 02-flash-engine
    provides: "Serial types pattern (FlashStage, FlashProgress) used as template for config types"
provides:
  - "DeviceConfigPayload, ConfigStage, ConfigProgress type contracts"
  - "GET /api/config authenticated endpoint returning per-user device config"
  - "meshtasticConfig frozen config object with env-driven values and dev stubs"
  - "ElectroDB client and read-only RunUser entity for flash app"
affects: [03-02, 03-03]

# Tech tracking
tech-stack:
  added: ["@meshtastic/core", "@meshtastic/transport-web-serial", "electrodb", "@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"]
  patterns: ["frozen config object with dev stubs", "read-only entity subset across apps", "server-only env vars (no NEXT_PUBLIC_)"]

key-files:
  created:
    - apps/run.flash/webapp/src/types/config.ts
    - apps/run.flash/webapp/src/config/meshtastic.ts
    - apps/run.flash/webapp/src/entities/client.ts
    - apps/run.flash/webapp/src/entities/run-user.ts
    - apps/run.flash/webapp/src/app/api/config/route.ts
  modified:
    - apps/run.flash/webapp/package.json

key-decisions:
  - "Read-only RunUser entity subset in flash app -- only userId, displayName, mqttUsername, mqttPassword attributes needed"
  - "Server-only env vars without NEXT_PUBLIC_ prefix to prevent secrets leaking to client bundles"
  - "Dev stub MQTT credentials (dev_user/dev_pass) when DynamoDB unavailable in development"

patterns-established:
  - "Frozen config object pattern: Object.freeze({...}) with process.env fallback to hardcoded dev stubs"
  - "Cross-app entity sharing: minimal read-only ElectroDB entity matching model/version/service of source app"
  - "Config type contracts: DeviceConfigPayload interface as API contract between server route and client consumer"

requirements-completed: [SRVR-01, SRVR-02, SRVR-03]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 3 Plan 1: Config Engine Server API Summary

**Authenticated GET /api/config endpoint with ElectroDB RunUser entity, Meshtastic config with dev stubs, and DeviceConfigPayload type contracts**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T20:05:16Z
- **Completed:** 2026-02-28T20:07:35Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- DeviceConfigPayload, ConfigStage, ConfigProgress types established as contract between server API and client config engine
- Environment-driven meshtasticConfig with hardcoded dev stubs -- zero env var setup for local development
- Authenticated /api/config endpoint that assembles per-user MQTT credentials from DynamoDB RunUser entity
- ElectroDB client and read-only RunUser entity subset matching run.human's entity model exactly

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create type contracts + Meshtastic config** - `da64d44` (feat)
2. **Task 2: Create ElectroDB entities and authenticated /api/config endpoint** - `098255b` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/src/types/config.ts` - DeviceConfigPayload, ConfigStage, ConfigProgress type contracts
- `apps/run.flash/webapp/src/config/meshtastic.ts` - Frozen Meshtastic config with env-driven values and dev stubs
- `apps/run.flash/webapp/src/entities/client.ts` - ElectroDB DynamoDB client for flash app
- `apps/run.flash/webapp/src/entities/run-user.ts` - Read-only RunUser entity subset (userId, displayName, mqttUsername, mqttPassword)
- `apps/run.flash/webapp/src/app/api/config/route.ts` - Authenticated GET endpoint returning DeviceConfigPayload
- `apps/run.flash/webapp/package.json` - Added @meshtastic/core, electrodb, AWS SDK dependencies

## Decisions Made
- Read-only RunUser entity with only 4 attributes needed for config -- avoids pulling crypto/qr dependencies into flash app
- Server-only env vars (MQTT_SERVER, DCR34_PRIMARY_PSK, etc.) without NEXT_PUBLIC_ prefix ensures secrets never reach client bundles
- Dev mode provides stub MQTT credentials when DynamoDB unavailable, production returns 404 for unprovisioned users
- RunUser entity model/version/service exactly matches run.human (`entity: "RunUser"`, `version: "1"`, `service: "run"`) to share DynamoDB table

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Dev stubs provide all values needed for local development.

## Next Phase Readiness
- GET /api/config endpoint ready for client-side config engine (Plan 02) to consume
- ConfigStage and ConfigProgress types ready for the config push UI pipeline
- @meshtastic/core and @meshtastic/transport-web-serial installed for Plan 02 device communication

## Self-Check: PASSED

- All 5 created files verified present on disk
- Both task commits (da64d44, 098255b) verified in git log
- npm run build passes with /api/config route listed
- No "use client" directives in server-side files
- No NEXT_PUBLIC_ env vars in meshtastic.ts
- RunUser entity model matches run.human exactly

---
*Phase: 03-config-engine-server-api*
*Completed: 2026-02-28*
