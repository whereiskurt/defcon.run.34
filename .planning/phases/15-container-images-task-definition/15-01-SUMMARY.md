---
phase: 15-container-images-task-definition
plan: 01
subsystem: infra
tags: [mosquitto, mqtt, docker, alpine, container]

# Dependency graph
requires:
  - phase: 14-infrastructure-foundation
    provides: ECS service modules and NLB configuration for MQTT
provides:
  - Mosquitto container image (Dockerfile, entrypoint, ACL)
  - apps/mqtt/ directory structure with meshtk symlink
affects: [15-02, 15-03, 16-build-deploy-pipeline]

# Tech tracking
tech-stack:
  added: [mosquitto, mosquitto-clients, alpine-3.21]
  patterns: [entrypoint-config-generation, env-var-service-accounts]

key-files:
  created:
    - apps/mqtt/.gitignore
    - apps/mqtt/mosquitto/Dockerfile.mosquitto
    - apps/mqtt/mosquitto/entrypoint.sh
    - apps/mqtt/mosquitto/acl.conf
  modified: []

key-decisions:
  - "Alpine base image with mosquitto package (not eclipse-mosquitto official image)"
  - "Entrypoint generates mosquitto.conf and passwd from environment variables at startup"

patterns-established:
  - "Entrypoint config generation: container generates config from env vars at startup rather than baking config into image"
  - "Service account pattern: MQTT_{NAME}_USERNAME and MQTT_{NAME}_PASSWORD env vars per service"

requirements-completed: [CONT-01, CONT-06]

# Metrics
duration: 1min
completed: 2026-03-07
---

# Phase 15 Plan 01: MQTT Directory and Mosquitto Container Summary

**Alpine-based Mosquitto broker container with entrypoint-generated config, 3 service accounts, and port 1884 TCP-only listener**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-07T13:13:15Z
- **Completed:** 2026-03-07T13:14:36Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created apps/mqtt/ directory with .gitignore and meshtk symlink for Docker build access
- Built Mosquitto container image (Alpine 3.21) with entrypoint that generates mosquitto.conf and passwd from environment variables
- Configured 3 service accounts (meshtk-proxy, meshobserv, ghosts) with ACL granting readwrite on all topics

## Task Commits

Each task was committed atomically:

1. **Task 1: Create apps/mqtt/ directory with .gitignore and meshtk symlink** - `5f85e126` (feat)
2. **Task 2: Create Mosquitto container image files** - `17986128` (feat)

## Files Created/Modified
- `apps/mqtt/.gitignore` - Excludes meshtk/ symlink from git tracking
- `apps/mqtt/mosquitto/Dockerfile.mosquitto` - Alpine-based Mosquitto container with healthcheck on port 1884
- `apps/mqtt/mosquitto/entrypoint.sh` - Generates mosquitto.conf and passwd from env vars at startup
- `apps/mqtt/mosquitto/acl.conf` - ACL granting readwrite # to 3 service accounts

## Decisions Made
- Used Alpine 3.21 base with mosquitto package rather than eclipse-mosquitto official image (per CONTEXT.md decision)
- Entrypoint generates config at runtime from environment variables, keeping the image reusable across environments

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Mosquitto container image ready for build.sh integration (Phase 16)
- Service account password env vars (MQTT_MESHTK_PASSWORD, MQTT_MESHOBSERV_PASSWORD, MQTT_GHOSTS_PASSWORD) must be provided via ECS secrets from SSM
- Ready for 15-02 (meshtk-proxy container) and 15-03 (meshobserv/ghosts containers)

---
*Phase: 15-container-images-task-definition*
*Completed: 2026-03-07*
