---
phase: 14-infrastructure-foundation
plan: 02
subsystem: infra
tags: [terraform, terragrunt, nlb, mqtt, ecr, ecs, acm, route53, ssm]

requires:
  - phase: 14-01
    provides: "ecs-service module with proxy_protocol_v2 variable support"
provides:
  - "MQTT service.hcl with 3 ECR repos and 4 NLB load_balancers"
  - "NLB enabled in both us-east-1 and ca-central-1 regions"
  - "mqtt.defcon.run subdomain registered for ACM cert and Route53 zone"
  - "MQTT SSM parameter definitions for infrastructure config"
  - "site.hcl aggregation of mqtt ECR, task, and service"
affects: [14-03, 14-04, 15-container-definitions]

tech-stack:
  added: []
  patterns: ["NLB service.hcl with proxy_protocol_v2 per-listener control", "target_group_port override to avoid TG name collision"]

key-files:
  created:
    - infra/terraform/live/site/services/run.mqtt/service.hcl
  modified:
    - infra/terraform/live/site/site.hcl
    - infra/terraform/live/site/region/us-east-1/network/network.hcl
    - infra/terraform/live/site/region/ca-central-1/network/network.hcl

key-decisions:
  - "PP2 enabled only on meshtk ports (1883/8883), disabled on nginx (443) and websocket (8443)"
  - "target_group_port=8883 on TLS MQTT listener to avoid TG name collision with TCP MQTT listener"
  - "Empty containers array in task definition -- Phase 15 will populate"

patterns-established:
  - "NLB service pattern: type=nlb in load_balancers with per-listener proxy_protocol_v2 and health_check_protocol"
  - "target_group_port override pattern for multiple listeners targeting same container port"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03, INFRA-05, INFRA-07]

duration: 2min
completed: 2026-03-07
---

# Phase 14 Plan 02: MQTT Service Definition Summary

**MQTT service.hcl with 3 ECR repos, 4-port NLB listener mapping (1883/8883/443/8443), NLB enabled in both regions, and mqtt.defcon.run ACM/Route53 registration**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T03:03:19Z
- **Completed:** 2026-03-07T03:04:53Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created complete MQTT service definition with 3 ECR repos (mqtt-mosquitto, mqtt-nginx, mqtt-meshtk) for 2 regions
- Defined 4 NLB load_balancers with correct PP2 settings per CONTEXT.md locked decisions
- Enabled NLB in both us-east-1 and ca-central-1 network configurations
- Registered mqtt subdomain in site.hcl for automatic ACM cert and Route53 zone creation
- Added MQTT infrastructure SSM parameter definitions (blocklist_bucket, logs_bucket)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create run.mqtt service.hcl** - `8c7a87f8` (feat)
2. **Task 2: Update site.hcl and enable NLB** - `7e0474a1` (feat)

## Files Created/Modified
- `infra/terraform/live/site/services/run.mqtt/service.hcl` - MQTT service definition with ECR repos, task, service, and 4 NLB load_balancers
- `infra/terraform/live/site/site.hcl` - Added mqtt subdomain, service_conf, aggregation, and SSM definitions
- `infra/terraform/live/site/region/us-east-1/network/network.hcl` - NLB enabled
- `infra/terraform/live/site/region/ca-central-1/network/network.hcl` - NLB enabled

## Decisions Made
- PP2 enabled only on meshtk-targeted ports (1883/8883) per CONTEXT.md locked decisions; disabled on nginx (443) and websocket (8443)
- Used target_group_port=8883 on the TLS MQTT listener to avoid target group name collision with the TCP MQTT listener (both target container port 1883)
- Left containers array empty in task definition -- Phase 15 scope

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MQTT service definition ready for Phase 15 container population
- NLB infrastructure will be provisioned when `terragrunt apply` runs
- ACM cert for mqtt.defcon.run will be created via dns.subdomains registration
- Remaining Phase 14 plans (03, 04) can proceed for security groups and Terraform modules

---
*Phase: 14-infrastructure-foundation*
*Completed: 2026-03-07*
