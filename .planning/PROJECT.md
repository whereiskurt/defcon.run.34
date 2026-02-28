# DCR34 Meshtastic Flasher (flash.defcon.run)

## What This Is

A web-based Meshtastic device flasher and provisioner for DEF CON Run 34 participants. Authenticated users visit `flash.defcon.run`, pick their ESP32 device, flash DCR34-vetted firmware via Web Serial, and get their device fully configured (MQTT, channels, identity, radio settings) — all in one browser session. Eliminates manual firmware flashing and configuration that creates support burden at the event.

## Core Value

A participant can go from unboxed ESP32 to fully provisioned DCR34 mesh radio in a single browser session, with zero manual configuration steps.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — existing in run.human -->

- ✓ User can register Meshtastic radios with nodeId — existing (`apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts`)
- ✓ Radio registration has verification flow (6-digit codes, attempt limits) — existing
- ✓ Per-user MQTT credentials auto-generated (mqttUsername/mqttPassword on RunUser) — existing (`apps/run.human/webapp/src/entities/run-user.ts`)
- ✓ Quota system controls radio slot allocation (5 user / 20 admin) — existing
- ✓ OIDC authentication infrastructure across DCR34 apps — existing (`auth.defcon.run`)
- ✓ ECS Fargate + CloudFront deployment pipeline — existing (`apps/release-all.sh`)

### Active

<!-- Current scope — building toward these -->

- [ ] Browser detects Web Serial support and gates unsupported browsers at entry
- [ ] User can browse and filter ESP32 devices from vendored Meshtastic hardware database
- [ ] Device picker shows images, names, manufacturer, and support tier
- [ ] User can connect ESP32 device via Web Serial browser prompt
- [ ] App auto-detects chip architecture from selected device
- [ ] App flashes DCR34-pinned Meshtastic firmware via esptool.js over Web Serial
- [ ] Flash progress is displayed with meaningful status updates
- [ ] After flash, app pushes MQTT config (server, credentials, TLS) to device via @meshtastic/core
- [ ] After flash, app pushes channel config (DCR34 primary + PSK, bridge channels) to device
- [ ] After flash, app pushes identity config (long name, short name from user profile) to device
- [ ] After flash, app pushes radio config (region, modem preset, hop limit) to device
- [ ] MQTT credentials are pulled from user's existing RunUser entity (not generated separately)
- [ ] PSK and MQTT credentials are server-side only — never in client JS bundles
- [ ] Configuration values (MQTT server, channels, PSK, radio presets) are environment/config-driven with stub defaults
- [ ] Firmware binaries are vendored into the Docker image (zero runtime external dependencies)
- [ ] Step-by-step wizard flow: pick device → connect → flash → configure → done

### Out of Scope

- Radio registration in run.human from the flasher — defer to v2 (existing UI in run.human is sufficient)
- Multi-region deployment — single region (us-east-1) only; flashing is a physical USB activity
- Firmware version picker UI — app uses 1-2 DCR34-pinned versions, no user choice
- Custom firmware builds — stock Meshtastic firmware only
- Firefox/Safari support — Web Serial API is Chrome/Edge only
- MQTT broker provisioning — assumes mosquitto is already deployed and accepting credentials

## Context

- **Existing Meshtastic system:** run.human already has radio CRUD, verification, MQTT credential generation, and quota integration. The flasher consumes these existing APIs and data.
- **Key libraries:** `esptool.js` (Espressif's official JS port) for flashing, `@meshtastic/core` + `@meshtastic/transport-web-serial` for device configuration post-flash.
- **Device database:** Meshtastic's `hardware-list.json` (~122 devices) vendored into the app, filtered to ESP32 architectures only.
- **Firmware source:** Stock Meshtastic firmware from GitHub releases, vendored into Docker image at build time.
- **Browser constraint:** Web Serial API only works in Chrome/Edge over HTTPS. Local dev on `localhost` is exempt from HTTPS requirement.
- **MQTT credentials:** Already exist on RunUser entity as `mqttUsername` and `mqttPassword` (SHA256-derived). The flasher's `/api/config` route reads these directly.

## Constraints

- **Tech stack:** Next.js 16, React 19, HeroUI, Tailwind 4 — matches monorepo conventions
- **Auth:** OIDC client to `auth.defcon.run` — same pattern as run.human/run.gpx
- **Deploy:** Single-region ECS Fargate + CloudFront at `flash.defcon.run`
- **Browser:** Chrome or Edge required (Web Serial API)
- **Security:** All secrets (PSK, MQTT creds, channel config) served from server-side API only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vendor firmware into Docker image | Zero runtime dependency on GitHub; reliable at event time | — Pending |
| Single region deployment | Flashing is physical USB — multi-region adds complexity with no user benefit | — Pending |
| Use existing RunUser MQTT credentials | Already generated per-user; avoids duplicate credential systems | — Pending |
| Defer radio registration to v2 | Flash + configure is the core value; registration exists in run.human UI already | — Pending |
| Gate unsupported browsers at entry | Better UX than letting users browse then discover they can't flash | — Pending |
| Config-driven TBD values (stubs) | Radio presets, channel PSKs, MQTT server are event-specific; build flexible, fill in later | — Pending |

---
*Last updated: 2026-02-28 after initialization*
