---
phase: 14-infrastructure-foundation
plan: 03
subsystem: infra
tags: [terraform, terragrunt, s3, route53, nlb, mqtt, dns]

# Dependency graph
requires:
  - phase: 14-01
    provides: "nlb-dns module and network module NLB outputs"
  - phase: 14-02
    provides: "MQTT service.hcl, NLB enabled in both regions, mqtt subdomain registered"
provides:
  - "Regional S3 blocklist and logs buckets for MQTT in both us-east-1 and ca-central-1"
  - "Latency-based Route53 A records for mqtt.defcon.run via nlb-dns module per region"
  - "ecs-service mock outputs ready for run-mqtt task definition"
affects: [14-04, 15-container-definitions, mqtt-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Inline Terraform with child module call in terragrunt unit (source = '.')", "zone_map dependency for subdomain zone_id lookup"]

key-files:
  created:
    - infra/terraform/live/site/region/us-east-1/mqtt/terragrunt.hcl
    - infra/terraform/live/site/region/us-east-1/mqtt/main.tf
    - infra/terraform/live/site/region/us-east-1/mqtt/variables.tf
    - infra/terraform/live/site/region/us-east-1/mqtt/outputs.tf
    - infra/terraform/live/site/region/ca-central-1/mqtt/terragrunt.hcl
    - infra/terraform/live/site/region/ca-central-1/mqtt/main.tf
    - infra/terraform/live/site/region/ca-central-1/mqtt/variables.tf
    - infra/terraform/live/site/region/ca-central-1/mqtt/outputs.tf
    - infra/terraform/modules/nlb-dns/v1.0.0/versions.tf
  modified:
    - infra/terraform/live/site/region/us-east-1/ecs-service/terragrunt.hcl
    - infra/terraform/live/site/region/ca-central-1/ecs-service/terragrunt.hcl

key-decisions:
  - "Inline Terraform (source='.') for mqtt/ unit since it combines S3 resources with nlb-dns child module call"
  - "ecs_services.enabled gate for mqtt/ exclude block (same as ecs-service pattern)"
  - "Added configuration_aliases to nlb-dns module to support child module usage"

patterns-established:
  - "Inline terragrunt unit pattern: terraform { source = '.' } with .tf files alongside terragrunt.hcl"
  - "zone_map lookup from site dependency: dependency.site.outputs.zone_map['subdomain.zone'].zone_id"

requirements-completed: [INFRA-04, INFRA-06, INFRA-08, INFRA-10]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 14 Plan 03: Regional MQTT Terragrunt Units Summary

**S3 blocklist and logs buckets per region with 30-day lifecycle, latency-based nlb-dns Route53 records for mqtt.defcon.run, and ecs-service mock outputs for run-mqtt**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T03:08:08Z
- **Completed:** 2026-03-07T03:11:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Created regional mqtt/ terragrunt units in both us-east-1 and ca-central-1 with S3 blocklist bucket, S3 logs bucket (30-day expiry), and nlb-dns module call for latency-based DNS
- Updated ecs-service mock outputs in both regions to include run-mqtt task definition and non-null nlb_arn
- Fixed nlb-dns module to support child module usage by adding versions.tf with configuration_aliases

## Task Commits

Each task was committed atomically:

1. **Task 1: Create regional mqtt/ terragrunt units with S3 buckets and nlb-dns** - `cdbebeb8` (feat)
2. **Task 2: Update ecs-service mock outputs for MQTT and NLB** - `da4c5c86` (feat)

## Files Created/Modified
- `infra/terraform/live/site/region/us-east-1/mqtt/terragrunt.hcl` - Terragrunt wiring with network and site dependencies, ecs_services gate
- `infra/terraform/live/site/region/us-east-1/mqtt/main.tf` - S3 blocklist/logs buckets and nlb-dns module call
- `infra/terraform/live/site/region/us-east-1/mqtt/variables.tf` - Input variables for site, region, NLB, and DNS
- `infra/terraform/live/site/region/us-east-1/mqtt/outputs.tf` - Bucket names/ARNs and DNS FQDN outputs
- `infra/terraform/live/site/region/ca-central-1/mqtt/*` - Identical structure for ca-central-1
- `infra/terraform/modules/nlb-dns/v1.0.0/versions.tf` - Required providers with configuration_aliases for aws.global-application
- `infra/terraform/live/site/region/us-east-1/ecs-service/terragrunt.hcl` - Added run-mqtt mock, non-null nlb_arn mock
- `infra/terraform/live/site/region/ca-central-1/ecs-service/terragrunt.hcl` - Added run-mqtt mock, non-null nlb_arn mock

## Decisions Made
- Used inline Terraform (`source = "."`) for the mqtt/ unit since it combines S3 bucket resources with a child module call to nlb-dns -- this avoids creating a separate wrapper module
- Used `ecs_services.enabled` from site.hcl as the exclude gate (consistent with ecs-service pattern) rather than checking NLB config from per-region network.hcl
- Added `versions.tf` with `configuration_aliases` to nlb-dns module to enable proper child module provider passing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added configuration_aliases to nlb-dns module**
- **Found during:** Task 1 (mqtt/ terragrunt unit creation)
- **Issue:** nlb-dns module uses `provider = aws.global-application` but lacked `configuration_aliases` declaration, which is required when the module is called as a child module (vs root module where Terragrunt generates provider.tf directly)
- **Fix:** Created `versions.tf` with `terraform { required_providers { aws = { configuration_aliases = [aws.global-application] } } }`
- **Files modified:** infra/terraform/modules/nlb-dns/v1.0.0/versions.tf
- **Verification:** File exists with correct content
- **Committed in:** cdbebeb8 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed exclude condition to use ecs_services.enabled**
- **Found during:** Task 1 (terragrunt.hcl creation)
- **Issue:** Plan suggested checking `nlb.enabled` from site.hcl, but NLB config is in per-region network.hcl, not site.hcl. Using `local.site_vars.locals.nlb.enabled` would fail at terragrunt parse time.
- **Fix:** Changed exclude condition to `!local.site_vars.locals.ecs_services.enabled` which is the standard pattern used by ecs-service and other units
- **Files modified:** Both mqtt/terragrunt.hcl files
- **Committed in:** cdbebeb8 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Regional mqtt/ terragrunt units ready for `terragrunt apply` to create S3 buckets and DNS records
- ecs-service mock outputs ready for MQTT service deployment planning
- S3 bucket names and ARNs available as outputs for Phase 15 container environment variables
- mqtt.defcon.run DNS records will resolve to regional NLBs with latency-based routing once applied

---
*Phase: 14-infrastructure-foundation*
*Completed: 2026-03-07*
