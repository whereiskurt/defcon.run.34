---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Flash Service Refresh
status: Phase 18 verified (human_needed) — PR #219 open; ready for /gsd-plan-phase 19
stopped_at: Phase 18 verification complete; hardware-in-loop blockers routed to STATE.md
last_updated: "2026-07-01T21:35:00.000Z"
last_activity: 2026-07-01 — Phase 18 verify=human_needed (4/5 SCs green); PR #219 opened
progress:
  total_phases: 2
  completed_phases: 0
  total_plans: 3
  completed_plans: 3
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06)

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation.
**Current focus:** v1.4 Flash Service Refresh -- Phase 18 verify=human_needed (PR #219 open, hardware-in-loop blockers listed); Phase 19 next.

## Current Position

Phase: 19 - Dependencies & DCR34 Branding/UX (not started)
Plan: —
Status: Phase 18 verified (human_needed) — PR #219; ready for /gsd-plan-phase 19
Last activity: 2026-07-01 — Phase 18 verify=human_needed (4/5 SCs green); PR #219 opened

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.4]: Latest-stable firmware resolved at build time (not runtime) — preserves zero-runtime-dependency guarantee
- [v1.4]: No firmware version picker — one auto-tracked stable build (supersedes v1.0 out-of-scope note)
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
- [Phase 16]: get_components() replaces has_nginx+get_app_component for build loop iteration
- [Phase 16]: --skip-nginx never skips mqtt's nginx (primary serving container)
- [Phase 17]: Ghost mode QR redirect removed; accomplishment API call kept as silent fire-and-forget
- [Phase 17]: DC33 logo images reused with dc34 filenames (visual swap deferred)

### Pending Todos

None.

### Blockers/Concerns

- [v1.4 / Phase 18 — HARDWARE-IN-LOOP]: **FLSH-08 boot verification** — one Recommended ESP32 (HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, or STATION_G2) must be flashed end-to-end from a container built via `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/` and boot cleanly after unplug/replug. Blocks Phase 18 closure. Cannot be exercised in sandbox — requires physical hardware + Chrome/Edge Web Serial.
- [v1.4 / Phase 18 — NETWORK+DOCKER]: **Clean `docker build` on current Meshtastic stable** — needs outbound network to api.meshtastic.org + github.com and Docker daemon. Confirms the API-resolve path + DPLY-06 grep gate arm correctly against a real `.next/standalone`.
- [v1.4 / Phase 18 — RUNTIME OBSERVATION]: **DPLY-06 runtime absence of upstream calls** — Pick→Connect→Flash→Configure→Done must emit zero requests to `api.meshtastic.org` / `github.com/meshtastic`. Build-time grep gate is armed; behavioral confirmation requires manual browser DevTools or container tcpdump.
- ~~[v1.4 / Phase 18]: FLSH-08 open risk — current build keeps app-only `firmware-{target}-{version}.bin` written at `0x00`, not `*.factory.bin`~~ FIXED in 18-01 (`.factory.bin` filename) + 18-03 (Dockerfile Stage 1 extracts `.factory.bin`); boot itself now tracked as hardware-in-loop blocker above.
- ~~ecs-service module auto-enables Proxy Protocol v2 on NLB TCP targets~~ FIXED in 14-01
- ~~Security group outputs exclude MQTT ports~~ FIXED in 14-01 (conditional NLB SG)
- ~~Route53 NLB alias records not covered by existing cloudfront module~~ FIXED in 14-01 (new nlb-dns module)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 2 | Auto-register flashed radios from run.flash into run.human meshtastic radios with node ID and private key | 2026-03-13 | fa05249e | [2-auto-register-flashed-radios-from-run-fl](./quick/2-auto-register-flashed-radios-from-run-fl/) |

## Deferred Items

Items acknowledged and deferred at v1.3 milestone close on 2026-07-01
(pre-existing stragglers from already-shipped milestones — not v1.3 scope):

| Category | Item | Status |
|----------|------|--------|
| verification | Phase 05 (v1.1) — 05-VERIFICATION.md | human_needed |
| quick_task | 1-wizard-panel-consistency-uniform-image-b | unknown |
| quick_task | 2-auto-register-flashed-radios-from-run-fl | unknown |

Also deferred: **Phase 18 Fleet Simulator + Easter Egg** (v1.3 scope, non-essential
easter egg) → `.planning/backlog/fleet-simulator-easter-egg.md`.
Note: v1.4 reuses the phase number 18 for Build-Time Firmware & Device List Refresh;
the deferred fleet-simulator work lives only in the backlog file, not as a numbered phase.

## Session Continuity

Last session: 2026-07-01T18:50:35.741Z
Stopped at: Phase 18 context gathered
Resume file: .planning/phases/18-build-time-firmware-device-list-refresh/18-CONTEXT.md

## Operator Next Steps

- Plan the first v1.4 phase with /gsd-plan-phase 18
