---
phase: 04-deployment-firmware-vendoring
plan: 02
subsystem: infra
tags: [terragrunt, ecs, ecr, cloudfront, docker, bash, oidc]

# Dependency graph
requires:
  - phase: 01-app-scaffold-device-picker
    provides: flash app scaffold and auth configuration
provides:
  - run-flash ECS task and service definition (service.hcl)
  - flash integrated into all 8 site.hcl aggregation points
  - CloudFront mock outputs for flash across all 3 regions
  - build/deploy/release/version script support for run.flash
  - apse1 OIDC redirect URIs for flash client
  - flash SSM secret definitions
affects: [deployment, release-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [service.hcl per-app pattern for ECS task/service/ECR definition]

key-files:
  created:
    - infra/terraform/live/site/services/run.flash/service.hcl
    - infra/terraform/live/site/services/run.flash/VERSION.app
    - infra/terraform/live/site/services/run.flash/VERSION.nginx
  modified:
    - infra/terraform/live/site/site.hcl
    - infra/terraform/live/site/global/cloudfront/terragrunt.hcl
    - apps/build.sh
    - apps/deploy.sh
    - apps/release-all.sh
    - apps/version.sh
    - apps/run.auth/webapp/src/config/oidc.ts

key-decisions:
  - "Flash uses run-human-electro DynamoDB table (no own table) -- shared read-only access via SSM secrets"
  - "desired_count=1 and autoscaling disabled -- booth tool with limited concurrent users"
  - "Flash secret definition only needs client_id and client_secret -- minimal OIDC credential set"

patterns-established:
  - "Service.hcl pattern: new apps follow run.human structure minus unused blocks (DynamoDB, uploads)"

requirements-completed: [DPLY-02, DPLY-03, DPLY-04]

# Metrics
duration: 4min
completed: 2026-03-01
---

# Phase 04 Plan 02: Infrastructure Registration Summary

**run-flash ECS service registered across all infrastructure aggregation points, build scripts, and OIDC config for 3-region deployment**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T03:35:25Z
- **Completed:** 2026-03-01T03:39:32Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Created complete ECS task and service definition for run-flash (nginx + app containers, 512 CPU / 1024 MiB)
- Wired flash into all 8 site.hcl aggregation points: dns, urls, local_ports, service_conf, cloudfront, ecr, ecs_tasks, ecs_services
- Added flash secret definition and CloudFront mock outputs for all 3 regions (use1, cac1, apse1)
- Registered run.flash in build.sh, deploy.sh, release-all.sh, and version.sh with correct mappings
- Added apse1 OIDC redirect URI and post_logout_redirect_uri for flash client

## Task Commits

Each task was committed atomically:

1. **Task 1: Create service.hcl and update site.hcl infrastructure aggregation** - `0648423` (feat)
2. **Task 2: Register run.flash in build/deploy/release/version scripts and add apse1 OIDC redirect** - `02047a0` (feat)

## Files Created/Modified
- `infra/terraform/live/site/services/run.flash/service.hcl` - ECS task (nginx + app containers) and service definition
- `infra/terraform/live/site/services/run.flash/VERSION.app` - App version pinned at v0.0.1
- `infra/terraform/live/site/services/run.flash/VERSION.nginx` - Nginx version pinned at v0.0.1
- `infra/terraform/live/site/site.hcl` - Added flash to all 8 aggregation points plus secrets definition
- `infra/terraform/live/site/global/cloudfront/terragrunt.hcl` - Added flash mock outputs for all 3 regions
- `apps/build.sh` - Added run.flash case with dc34-run-flash prefix and flash.defcon.run origin
- `apps/deploy.sh` - Added run.flash case with TF_SERVICE=run.flash
- `apps/release-all.sh` - Added run.flash to default APPS and all helper functions
- `apps/version.sh` - Added run.flash to validation
- `apps/run.auth/webapp/src/config/oidc.ts` - Added apse1 redirect URIs for flash client

## Decisions Made
- Flash uses run-human-electro DynamoDB table via SSM secret references (no separate table needed since flash only reads user config data)
- desired_count=1 with autoscaling disabled (min=1, max=2) -- booth tool serving limited concurrent users
- Flash secret definition contains only client_id and client_secret -- minimal OIDC credential set
- Explicit run.flash cases in has_nginx and get_app_component helper functions for clarity even though defaults already handle it

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Flash app is fully registered in infrastructure -- `terragrunt plan --all` will include flash resources
- `release-all.sh --apps run.flash` ready to build and push flash images
- Actual flash app Docker images (nginx + webapp) need to be built before first deployment
- SSM secrets for flash OIDC credentials must be provisioned in each region before ECS tasks can start

---
*Phase: 04-deployment-firmware-vendoring*
*Completed: 2026-03-01*
