# DCR34 Meshtastic Flasher (flash.defcon.run)

## What This Is

A web-based Meshtastic device flasher and provisioner for DEF CON Run 34 participants. Authenticated users visit `flash.defcon.run`, pick their ESP32 device, flash DCR34-vetted firmware via Web Serial, and get their device fully configured (MQTT, channels, identity, radio settings) — all in one browser session. Eliminates manual firmware flashing and configuration that creates support burden at the event.

**Shipped v1.0** — live at flash.defcon.run with 4,900+ LOC TypeScript across 4 phases.

## Core Value

A participant can go from unboxed ESP32 to fully provisioned DCR34 mesh radio in a single browser session, with zero manual configuration steps.

## Requirements

### Validated

- ✓ Browser detects Web Serial support and gates unsupported browsers at entry — v1.0
- ✓ User can browse and filter ESP32 devices from vendored Meshtastic hardware database — v1.0
- ✓ Device picker shows images, names, manufacturer, and support tier — v1.0
- ✓ User can connect ESP32 device via Web Serial browser prompt — v1.0
- ✓ App flashes DCR34-pinned Meshtastic firmware via esptool.js over Web Serial — v1.0
- ✓ Flash progress is displayed with meaningful status updates — v1.0
- ✓ After flash, app pushes MQTT, channel, identity, and radio config to device via @meshtastic/core — v1.0
- ✓ MQTT credentials fetched from run.human via internal API (resolves OIDC sub → adapter userId) — v1.0
- ✓ PSK and MQTT credentials are server-side only — never in client JS bundles — v1.0
- ✓ Configuration values are environment/config-driven with stub defaults — v1.0
- ✓ Firmware binaries vendored into Docker image (zero runtime external dependencies) — v1.0
- ✓ Step-by-step wizard: Pick Device → Connect → Flash → Configure → Done — v1.0
- ✓ Production deployment: multi-region ECS Fargate + CloudFront at flash.defcon.run — v1.0
- ✓ Flash service claim check (like gpxstudio) with access-denied page — v1.0
- ✓ All CI/CD workflows (buildpub, deploy, rollback, npm-audit) include run.flash — v1.0

### Active

- [ ] Device-specific bootloader guidance (hold BOOT, press RESET) when connection fails (CONN-03)
- [ ] Flash completion shows clear success/failure with actionable guidance on failure (FLSH-04)
- [ ] ConfigUI service entry for run.flash (matching run.gpx/run.human pattern)
- [ ] Radio registration from flasher — link flashed device to run.human's Meshtastic radio system

### Out of Scope

- Firmware version picker UI — app uses 1-2 DCR34-pinned versions, no user choice
- Custom firmware builds — stock Meshtastic firmware only
- Firefox/Safari support — Web Serial API is Chrome/Edge only
- MQTT broker provisioning — assumes mosquitto is already deployed
- BLE flashing — USB Web Serial is faster and more reliable for initial provisioning
- Offline/PWA mode — requires auth and per-user config (both online)

## Context

- **Tech stack:** Next.js 16, React 19, HeroUI, Tailwind 4, esptool.js, @meshtastic/core
- **Codebase:** ~4,900 LOC TypeScript in `apps/run.flash/webapp/src/`
- **Architecture:** Flash app calls run.human's internal API (`/api/internal/user/:oidcSub`) for MQTT credentials rather than direct DynamoDB access. This bridges the OIDC subject → DynamoDB adapter userId gap.
- **Deployment:** 3-stage Docker build (firmware download → Next.js build → production runner), nginx TLS sidecar, cookie-based region router defaulting to /use1/
- **Known issue:** Image basePaths and API fetch paths needed manual region prefix — pattern to watch for in future apps

## Constraints

- **Tech stack:** Next.js 16, React 19, HeroUI, Tailwind 4 — matches monorepo conventions
- **Auth:** OIDC client to `auth.defcon.run` — same pattern as run.human/run.gpx
- **Deploy:** Multi-region ECS Fargate + CloudFront at `flash.defcon.run`
- **Browser:** Chrome or Edge required (Web Serial API)
- **Security:** All secrets served from server-side API only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vendor firmware into Docker image | Zero runtime dependency on GitHub; reliable at event time | ✓ Good — 3-stage build works cleanly |
| Multi-region deployment | Consistency with all other DCR34 apps | ✓ Good — same patterns, same scripts |
| Use run.human internal API for MQTT creds | OIDC subject ≠ DynamoDB adapter userId; direct DB access fails | ✓ Good — clean service boundary |
| Defer radio registration to v2 | Flash + configure is the core value | ✓ Good — keeps scope tight |
| Gate unsupported browsers at entry | Better UX than discovering inability at flash step | ✓ Good |
| Config-driven TBD values (stubs) | Event-specific values filled in later | ✓ Good — meshtastic.ts is the single config source |
| Flash service claim check | Gate access like gpxstudio | ✓ Good — consistent authorization model |

---
*Last updated: 2026-03-02 after v1.0 milestone*
