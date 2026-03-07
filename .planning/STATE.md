---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Meshtk Integration
status: executing
stopped_at: Completed 16-01-PLAN.md
last_updated: "2026-03-07T14:10:44Z"
last_activity: 2026-03-07 -- Completed 16-01 mqtt build pipeline
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 6
  completed_plans: 7
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06)

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation.
**Current focus:** Phase 16 - Build & Deploy Pipeline

## Current Position

Phase: 16 of 18 (Build & Deploy Pipeline)
Plan: 1 of 2 in current phase (16-01 complete)
Status: In progress
Last activity: 2026-03-07 -- Completed 16-01 mqtt build pipeline (build.sh, version.sh, VERSION files)

Progress: [======....] 60% (3/5 v1.3 phases, 1/2 phase 16 plans)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.3]: NLB-only for mqtt.defcon.run (no CloudFront -- MQTT is raw TCP)
- [v1.3]: Route53 latency routing for NLB (nearest region)
- [v1.3]: Meshtk as gitignored copy (avoid submodule overhead)
- [Phase 14]: PP2 enabled only on meshtk ports (1883/8883), disabled on nginx/websocket ports
- [Phase 14]: target_group_port=8883 to avoid TG name collision when two listeners target same container port
- [Phase 14]: Inline Terraform (source='.') for mqtt/ terragrunt unit combining S3 resources with nlb-dns child module
- [Phase 14]: Added configuration_aliases to nlb-dns module for child module provider passing
- [Phase 15]: Alpine base with mosquitto package (not eclipse-mosquitto official image)
- [Phase 15]: Entrypoint generates mosquitto.conf and passwd from env vars at startup
- [Phase 15]: Replaced meshtk symlink with tracked directory (Dockerfile tracked, Go source gitignored)
- [Phase 15]: meshobserv is same meshtk binary invoked as 'server inspect' (single Go build)
- [Phase 15]: Usernames in env vars, only passwords in SSM secrets for MQTT containers
- [Phase 16]: APP_DIR override maps run.mqtt to apps/mqtt/ (non-standard directory naming)
- [Phase 16]: resolve_meshtk clones from GitHub in CI, copies from symlink locally

### Pending Todos

None.

### Blockers/Concerns

- ~~ecs-service module auto-enables Proxy Protocol v2 on NLB TCP targets~~ FIXED in 14-01
- ~~Security group outputs exclude MQTT ports~~ FIXED in 14-01 (conditional NLB SG)
- ~~Route53 NLB alias records not covered by existing cloudfront module~~ FIXED in 14-01 (new nlb-dns module)

## Session Continuity

Last session: 2026-03-07T14:10:44Z
Stopped at: Completed 16-01-PLAN.md
Resume file: .planning/phases/16-build-deploy-pipeline/16-01-SUMMARY.md
