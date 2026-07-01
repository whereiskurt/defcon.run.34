---
phase: 15-container-images-task-definition
plan: 03
subsystem: infra
tags: [ecs, terraform, docker, mqtt, containers, nlb]

# Dependency graph
requires:
  - phase: 14-infrastructure-foundation
    provides: "service.hcl skeleton with ECR repos and NLB load_balancers"
  - phase: 15-container-images-task-definition/15-01
    provides: "mosquitto Dockerfile and entrypoint"
  - phase: 15-container-images-task-definition/15-02
    provides: "meshtk proxy Dockerfile, nginx/meshobserv Dockerfile"
provides:
  - "4-container ECS task definition with dependency ordering"
  - "NLB port mapping (443->nginx:80, 1883/8883->meshtk:1883)"
  - "Local Docker build script for all MQTT containers"
affects: [16-build-deploy-pipeline, 17-ssm-parameters]

# Tech tracking
tech-stack:
  added: []
  patterns: [ecs-container-depends-on, non-essential-container, image-reuse-with-command-override]

key-files:
  created:
    - apps/mqtt/build.sh
  modified:
    - infra/terraform/live/site/services/run.mqtt/service.hcl

key-decisions:
  - "Usernames (meshtk-proxy, meshobserv, ghosts) in environment vars, only passwords in SSM secrets"
  - "Ghosts container uses START condition (not HEALTHY) since it has no health check"
  - "8443 WebSocket listener commented out with clear re-enablement note"

patterns-established:
  - "Container depends_on for ECS startup ordering: HEALTHY for essential deps, START for non-essential"
  - "Non-essential container pattern: essential=false allows task to continue if container fails"
  - "Image reuse with command override: ghosts reuses meshtk image with different entrypoint args"

requirements-completed: [CONT-04, CONT-05, CONT-07]

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 15 Plan 03: ECS Task Definition + Build Script Summary

**4-container ECS task with dependency-ordered startup (mosquitto->meshtk->nginx+ghosts), NLB 443->nginx:80 port mapping, and local build.sh**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T13:21:34Z
- **Completed:** 2026-03-07T13:23:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Populated service.hcl containers[] with 4 container definitions totaling 1024 CPU / 2048 MB
- Defined ECS dependency chain: mosquitto -> meshtk (HEALTHY) -> nginx (HEALTHY) + ghosts (START)
- Updated NLB port 443 to target nginx container_port 80 (NLB terminates TLS)
- Commented out 8443 WebSocket listener (deferred)
- Created apps/mqtt/build.sh for local Docker builds of all 3 images

## Task Commits

Each task was committed atomically:

1. **Task 1: Populate service.hcl with 4 containers and update NLB ports** - `a3b4479a` (feat)
2. **Task 2: Create apps/mqtt/build.sh for local Docker builds** - `24335027` (feat)

## Files Created/Modified
- `infra/terraform/live/site/services/run.mqtt/service.hcl` - 4-container ECS task definition with versions, dependency ordering, and updated NLB port mappings
- `apps/mqtt/build.sh` - Local Docker build script supporting individual or all component builds

## Decisions Made
- Moved usernames (meshtk-proxy, meshobserv, ghosts) to environment variables since they are not secret; only passwords remain in SSM secrets
- Used `$$SYS` in mosquitto health check command to escape the `$` for ECS task definition JSON
- Set memory_reservation lower than memory for all containers to allow burst memory usage within task limits

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- service.hcl is ready for Terraform plan/apply once SSM parameters are created (Phase 17)
- build.sh is ready for local Docker image builds
- Phase 16 will integrate into main apps/build.sh + apps/deploy.sh pipeline for ECR push

---
*Phase: 15-container-images-task-definition*
*Completed: 2026-03-07*

## Self-Check: PASSED
