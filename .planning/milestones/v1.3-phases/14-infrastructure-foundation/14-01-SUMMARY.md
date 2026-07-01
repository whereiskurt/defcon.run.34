---
phase: 14-infrastructure-foundation
plan: 01
subsystem: infra
tags: [terraform, ecs, nlb, route53, proxy-protocol, dns, mqtt]

# Dependency graph
requires: []
provides:
  - "ecs-service module with per-LB proxy_protocol_v2 toggle (backward compatible)"
  - "network module with conditional NLB security group in security_group_ids output"
  - "nlb-dns module for latency-based Route53 A alias records to NLB"
affects: [14-02, 14-03, mqtt-infrastructure, ecs-service-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns: ["null-default optional field for backward-compatible toggles", "conditional concat for optional security groups", "latency-based Route53 routing with set_identifier"]

key-files:
  created:
    - infra/terraform/modules/nlb-dns/v1.0.0/main.tf
    - infra/terraform/modules/nlb-dns/v1.0.0/variables.tf
    - infra/terraform/modules/nlb-dns/v1.0.0/outputs.tf
  modified:
    - infra/terraform/modules/ecs-service/v1.0.0/variables.tf
    - infra/terraform/modules/ecs-service/v1.0.0/main.tf
    - infra/terraform/modules/network/v1.0.0/outputs.tf

key-decisions:
  - "PP2 default is null (not false) to preserve backward compatibility via auto-detect fallback"
  - "nlb-dns module follows cloudfront pattern: no required_providers block, provider alias passed by caller"

patterns-established:
  - "Null-default toggle: optional(bool, null) with null-check fallback preserves existing behavior"
  - "Conditional output concat: concat base list with conditional extra elements"

requirements-completed: [INFRA-04, INFRA-08, INFRA-09]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 14 Plan 01: Module Patches Summary

**Per-LB proxy_protocol_v2 toggle in ecs-service, conditional NLB SG output, and new nlb-dns latency-routing module**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T03:03:00Z
- **Completed:** 2026-03-07T03:05:47Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added explicit per-LB proxy_protocol_v2 toggle to ecs-service module, preventing MQTT containers from receiving unwanted PP2 headers while preserving backward compatibility for existing services
- Conditionally included NLB security group in network module's security_group_ids output when NLB is enabled
- Created new nlb-dns module for latency-based Route53 A alias records pointing to NLB with per-region set_identifier and health-based failover

## Task Commits

Each task was committed atomically:

1. **Task 1: Patch ecs-service module PP2 toggle and network module SG output** - `21721a73` (feat)
2. **Task 2: Create nlb-dns module for latency-based Route53 records** - `ccec331d` (feat)

## Files Created/Modified
- `infra/terraform/modules/ecs-service/v1.0.0/variables.tf` - Added proxy_protocol_v2 optional bool field to load_balancer object
- `infra/terraform/modules/ecs-service/v1.0.0/main.tf` - Null-check PP2 toggle with auto-detect fallback, propagated through locals
- `infra/terraform/modules/network/v1.0.0/outputs.tf` - Conditional concat of NLB SG based on var.nlb.enabled
- `infra/terraform/modules/nlb-dns/v1.0.0/main.tf` - Route53 A alias with latency_routing_policy and set_identifier
- `infra/terraform/modules/nlb-dns/v1.0.0/variables.tf` - Module inputs: zone_id, domain_name, nlb_dns_name, nlb_zone_id, region
- `infra/terraform/modules/nlb-dns/v1.0.0/outputs.tf` - Record FQDN and name outputs

## Decisions Made
- PP2 default is `null` (not `false`) so existing services without the field continue to use auto-detect behavior unchanged
- nlb-dns module follows cloudfront module pattern: no `required_providers` block, provider alias (`aws.global-application`) passed by caller. This means standalone `terraform validate` fails (same as cloudfront), but works correctly when called from Terragrunt live config

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Propagated proxy_protocol_v2 through load_balancer_configs local**
- **Found during:** Task 1 (PP2 toggle implementation)
- **Issue:** The `load_balancer_configs` local in main.tf did not include `proxy_protocol_v2`, so `each.value.proxy_protocol_v2` on the target group resource would have been undefined
- **Fix:** Added `proxy_protocol_v2 = lb.proxy_protocol_v2` to the load_balancer_configs local map
- **Files modified:** infra/terraform/modules/ecs-service/v1.0.0/main.tf
- **Verification:** terraform validate passes
- **Committed in:** 21721a73 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for correctness -- field must flow through locals to be accessible on the resource. No scope creep.

## Issues Encountered
- nlb-dns module cannot pass standalone `terraform validate` due to provider alias pattern (same as existing cloudfront module). Verified with `terraform fmt -check` and confirmed pattern consistency instead.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three modules ready for MQTT infrastructure wiring in subsequent plans
- ecs-service module can now disable PP2 per load_balancer entry (set `proxy_protocol_v2 = false`)
- Network module will automatically include NLB SG when NLB is enabled in regional config
- nlb-dns module ready for per-region deployment to create latency-based DNS records

## Self-Check: PASSED

All 6 source files found. All 2 task commits verified. SUMMARY.md created.

---
*Phase: 14-infrastructure-foundation*
*Completed: 2026-03-07*
