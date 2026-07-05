---
gsd_state_version: 1.0
milestone: v1.9
milestone_name: CMS-Driven UI Copy Catalog
status: planning
last_updated: "2026-07-05T06:44:24.906Z"
last_activity: 2026-07-05
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06)

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation.
**Current focus:** Phase 33 — oidc-silent-sso

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-05 — Milestone v1.9 started

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
- [Phase ?]: Recorded grant mapping via session.grantIdFor(clientId, grantId) setter — oidc-provider@9.6.0 has no ensureGrantId
- [Phase ?]: loadExistingGrant built as an injectable factory (makeLoadExistingGrant) so mint/reuse/undefined branches are unit-testable without a live Provider
- [Phase ?]: Silent-SSO resolveSilentStatus keys success on ABSENCE of the next-auth error param (next-auth consumes code at its own callback), confirmed against installed @auth/core source
- [Phase ?]: RP silent-SSO unit authored literal-free in run.gpx (no gpx/whoami) so plan 03 copies byte-for-byte into flash/bib; login_required stays logged-out, fallback only on timeout (LOCKED contract)
- [Phase ?]: [Phase 33-03]: Silent-SSO 5-file unit placed byte-identically (cp) into flash + bib; three-way SHA-256 parity confirmed so plan-05 parity test has a stable baseline
- [Phase ?]: [Phase 33-03]: SilentSSO mounted at each app SessionProvider seam (flash layout.tsx, bib providers.tsx); pages.error mirrors pages.signIn region derivation — glue is outside the parity unit
- [Phase ?]: 33-04: IdP integration tests reuse run.auth/e2e @playwright/test + cookie-jar helpers (no new package/project); live-service cases gate on availability and skip rather than fabricate a green.
- [Phase ?]: 33-04: warm prompt=none cases establish the provider _session via a warm-up interactive authorize (sess_auth alone is insufficient for silent code).
- [Phase ?]: 33-05: Parity guarded by a node:fs test that reads the 5 unit files from gpx/flash/bib and asserts byte-equality vs canonical gpx (drift-detection proven by a temporary one-char mutation); pure-logic tests assert resolveSilentStatus success on error-ABSENCE (not a code param) and decideParentAction's foreign-origin→ignore anti-spoof gate — all in run.bib's existing node-env vitest, no new package.
- [Phase ?]: SSO-08 e2e invariant: forbid the auth /login RENDER (count==0) + /signin OSCILLATION; allow one transient /signin entry since every RP route auth-gates to /signin
- [Phase ?]: Silent-SSO e2e live cases gate on BOTH app + run.auth IdP reachability in a fixture-free beforeEach so the browser never launches on skip

### Pending Todos

None.

### Blockers/Concerns

- [v1.4 / Phase 19 — HARDWARE-IN-LOOP]: **tlora-t3s3 flashMode 'dio' boot** — verify the new explicit branch (`use-flash.ts:104-106`) produces a bootable tlora-t3s3 device (this quirk historically fixed pre-bump boot loops with the default `keep` mode). Only remaining v1.4 open item — Kurt didn't have a tlora-t3s3 during 2026-07-02 hardware verification.
- ~~[v1.4 / Phase 18 — HARDWARE-IN-LOOP]: FLSH-08 boot verification~~ VERIFIED 2026-07-02 by Kurt: Recommended ESP32 flashed end-to-end against the deployed run-flash-use1 service (task-def 71 / v0.0.5), booted cleanly.
- ~~[v1.4 / Phase 18 — NETWORK+DOCKER]: Clean `docker build` on current Meshtastic stable~~ TRANSITIVELY VERIFIED — the container serving flash.defcon.run at v0.0.5 IS the output of a clean CI `docker build`; the hardware flash used that image successfully.
- ~~[v1.4 / Phase 18 — RUNTIME OBSERVATION]: DPLY-06 runtime absence of upstream calls~~ VERIFIED 2026-07-02 by Kurt: Pick→Connect→Flash→Configure→Done emitted no calls to `api.meshtastic.org` or `github.com/meshtastic`.
- ~~[v1.4 / Phase 19 — HARDWARE-IN-LOOP]: End-to-end regression on bumped esptool-js 0.6.0~~ VERIFIED 2026-07-02 — same flash session as FLSH-08 above; the deployed image runs esptool-js 0.6.0 and the flow completed with no regression.
- ~~[v1.4 / Phase 19 — VISUAL PASS]: Branding + UX in-context checks~~ VERIFIED 2026-07-02 by Kurt: `run.defcon.run firmware · Meshtastic {version}` rendered correctly; connect / bootloader-help / error-state UX read coherently.
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

Last session: 2026-07-04T05:34:16.448Z
Stopped at: Phase 18 context gathered
Resume file: .planning/phases/18-build-time-firmware-device-list-refresh/18-CONTEXT.md

## Operator Next Steps

- Plan the first v1.4 phase with /gsd-plan-phase 18

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 33 P01 | 30m | 3 tasks | 7 files |
| Phase 33 P02 | 25min | 3 tasks | 7 files |
| Phase 33 P03 | 12min | 2 tasks | 14 files |
| Phase 33 P04 | ~25m | 2 tasks | 1 files |
| Phase 33 P06 | 8min | 2 tasks | 15 files |
