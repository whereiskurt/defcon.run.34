---
phase: 16-build-deploy-pipeline
plan: 02
subsystem: infra
tags: [bash, ecs, ecr, docker, ci-cd, github-actions, mqtt]

requires:
  - phase: 16-build-deploy-pipeline
    provides: "build.sh, version.sh, VERSION files for mqtt 3-component pattern"
provides:
  - "deploy.sh support for mqtt 3-file VERSION copy + ECS deploy"
  - "release-all.sh multi-region orchestration for mqtt 3 components"
  - "buildpub.yml CI/CD workflow including mqtt in default builds"
  - "get_components() helper function for component-based build abstraction"
affects: [17-service-mesh, 18-monitoring]

tech-stack:
  added: []
  patterns: ["get_components() abstraction for multi-component apps", "APP_DIR override for non-standard directory naming"]

key-files:
  created: []
  modified:
    - apps/deploy.sh
    - apps/release-all.sh
    - .github/workflows/buildpub.yml

key-decisions:
  - "get_components() replaces has_nginx+get_app_component for build loop iteration"
  - "--skip-nginx never skips mqtt's nginx since it is the primary serving container"

patterns-established:
  - "get_components() pattern: returns space-separated component list per app for build/version loops"
  - "mqtt APP_DIR override: run.mqtt maps to apps/mqtt/ in all scripts"

requirements-completed: [CONT-09]

duration: 3min
completed: 2026-03-07
---

# Phase 16 Plan 02: Deploy & Release Pipeline Summary

**Extended deploy.sh, release-all.sh, and buildpub.yml with mqtt 3-component build/deploy support using get_components() abstraction**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T14:12:56Z
- **Completed:** 2026-03-07T14:15:38Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- deploy.sh copies 3 VERSION files (mosquitto, meshtk, nginx) to terraform service dir for mqtt
- release-all.sh orchestrates mqtt build across all regions with 3 components via get_components()
- buildpub.yml CI workflow includes run.mqtt in default builds
- --skip-nginx correctly preserves mqtt's nginx (essential serving container, not optional proxy)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend deploy.sh for mqtt 3-file VERSION pattern** - `403c2e1f` (feat)
2. **Task 2: Extend release-all.sh and buildpub.yml for mqtt** - `6275cc28` (feat)

## Files Created/Modified
- `apps/deploy.sh` - Added run.mqtt validation, APP_DIR override, 3-file VERSION copy
- `apps/release-all.sh` - Added get_components(), mqtt support in all helpers, refactored build/version loops
- `.github/workflows/buildpub.yml` - Added run.mqtt to default apps input

## Decisions Made
- Introduced get_components() as a cleaner abstraction replacing the has_nginx+get_app_component pair for build iteration. All apps now route through get_components() for version bump and build loops.
- --skip-nginx explicitly excludes mqtt (`$APP != "run.mqtt"`) since mqtt's nginx is the primary web-serving container, not the optional reverse proxy that --skip-nginx targets.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- mqtt build/deploy pipeline complete end-to-end: build.sh, version.sh, deploy.sh, release-all.sh, buildpub.yml
- Ready for Terraform infrastructure deployment (Phase 17) and production releases

---
*Phase: 16-build-deploy-pipeline*
*Completed: 2026-03-07*
