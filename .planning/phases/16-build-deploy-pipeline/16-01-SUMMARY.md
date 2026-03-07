---
phase: 16-build-deploy-pipeline
plan: 01
subsystem: infra
tags: [docker, ecr, bash, mqtt, versioning, ci-cd]

# Dependency graph
requires:
  - phase: 15-container-images-task-definition
    provides: Dockerfiles for mosquitto, meshtk, nginx containers
provides:
  - build.sh support for mqtt components (mosquitto, meshtk, nginx) with ECR push
  - version.sh support for independent mqtt component version bumps
  - service.hcl reading versions from VERSION files instead of hardcoded strings
  - resolve_meshtk function for local symlink and CI clone workflows
affects: [16-02-deploy-script, 16-03-release-all]

# Tech tracking
tech-stack:
  added: []
  patterns: [multi-component VERSION file reads in HCL, APP_DIR override for non-standard directory naming]

key-files:
  created:
    - apps/mqtt/mosquitto/VERSION
    - apps/mqtt/meshtk/VERSION
    - apps/mqtt/nginx/VERSION
    - infra/terraform/live/site/services/run.mqtt/VERSION.mosquitto
    - infra/terraform/live/site/services/run.mqtt/VERSION.meshtk
    - infra/terraform/live/site/services/run.mqtt/VERSION.nginx
  modified:
    - apps/build.sh
    - apps/version.sh
    - apps/mqtt/.gitignore
    - infra/terraform/live/site/services/run.mqtt/service.hcl

key-decisions:
  - "APP_DIR override maps run.mqtt to apps/mqtt/ (directory naming mismatch)"
  - "resolve_meshtk clones from GitHub in CI, copies from symlink locally"

patterns-established:
  - "APP_DIR override: when app name differs from directory name, add explicit mapping after APP_DIR assignment"
  - "VERSION files in terraform service dir: deploy.sh copies VERSION files; service.hcl reads with trimspace(file())"

requirements-completed: [CONT-08]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 16 Plan 01: MQTT Build Pipeline Summary

**Extended build.sh and version.sh for 3 mqtt container components with per-component VERSION files and HCL file-based version reads**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T14:07:38Z
- **Completed:** 2026-03-07T14:10:44Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- build.sh accepts mosquitto, meshtk, nginx components for run.mqtt with ECR push
- version.sh independently bumps each mqtt component version
- service.hcl reads per-container versions from VERSION files via trimspace(file())
- resolve_meshtk handles local dev (symlink copy) and CI (git clone) workflows

## Task Commits

Each task was committed atomically:

1. **Task 1: Create VERSION files and extend build.sh for mqtt** - `e810cb18` (feat)
2. **Task 2: Extend version.sh and update service.hcl for VERSION file reads** - `073c24c8` (feat)

## Files Created/Modified
- `apps/mqtt/mosquitto/VERSION` - Mosquitto container version (v0.1.0)
- `apps/mqtt/meshtk/VERSION` - Meshtk container version (v0.1.0)
- `apps/mqtt/nginx/VERSION` - Nginx container version (v0.1.0)
- `apps/build.sh` - Extended with run.mqtt support, resolve_meshtk, mqtt component builds
- `apps/version.sh` - Extended with run.mqtt support, APP_DIR override
- `apps/mqtt/.gitignore` - Added exception for meshtk/VERSION
- `infra/terraform/live/site/services/run.mqtt/service.hcl` - Reads versions from VERSION files
- `infra/terraform/live/site/services/run.mqtt/VERSION.mosquitto` - Initial version for terragrunt
- `infra/terraform/live/site/services/run.mqtt/VERSION.meshtk` - Initial version for terragrunt
- `infra/terraform/live/site/services/run.mqtt/VERSION.nginx` - Initial version for terragrunt

## Decisions Made
- APP_DIR override maps run.mqtt to apps/mqtt/ since mqtt directory doesn't follow run.* naming convention
- resolve_meshtk uses git clone in CI (GITHUB_ACTIONS set) vs symlink copy locally for consistent builds

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated .gitignore to allow meshtk/VERSION tracking**
- **Found during:** Task 1 (VERSION file creation)
- **Issue:** apps/mqtt/.gitignore had `meshtk/*` rule ignoring all files except Dockerfile, blocking git add of VERSION
- **Fix:** Added `!meshtk/VERSION` exception to .gitignore
- **Files modified:** apps/mqtt/.gitignore
- **Verification:** git add succeeded after .gitignore update
- **Committed in:** e810cb18 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for VERSION file tracking. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- build.sh ready for mqtt container builds to ECR
- version.sh ready for independent mqtt version management
- service.hcl ready to consume VERSION files from deploy.sh
- Next plan (16-02) can wire deploy.sh to copy VERSION files and trigger ECS deployments

---
*Phase: 16-build-deploy-pipeline*
*Completed: 2026-03-07*
