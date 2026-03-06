# DEF CON Run 34 (defcon.run)

## What This Is

The official DEF CON Run 34 platform — a suite of web apps for organizing and participating in running/hiking events at DEF CON 34. Includes device provisioning (flash.defcon.run), GPX route editing (gpx.defcon.run), content management (cms.defcon.run), authentication (auth.defcon.run), and the main participant dashboard (run.defcon.run).

**Shipped v1.0** — Meshtastic Flasher MVP (flash.defcon.run) with browser-based ESP32 flashing and configuration.
**Shipped v1.1** — CMS Content Types (cms.defcon.run) with Events, Routes, POIs, and relations.
**Shipped v1.2** — User Checkins (run.defcon.run) with GPS check-in, privacy controls, Leaflet map profile display.

## Core Value

Participants and organizers have a seamless digital experience for DEF CON Run 34 — from device setup to event discovery to route navigation — all through the browser.

## Current State

v1.2 shipped. Ready for next milestone planning.

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
- ✓ Event, Route, and POI content types with shared coordinates component — v1.1
- ✓ Bidirectional many-to-many relations (Events↔Routes, Routes↔POIs) — v1.1
- ✓ Public REST API with population, filtering, field selection — v1.1
- ✓ DCR34-branded OIDC login page and error pages on cms.defcon.run — v1.1
- ✓ Litestream worker sync safety (WAL checkpoint + safe swap) — v1.1
- ✓ S3 upload provider upgraded to Strapi 5 — v1.1
- ✓ CMS sync verified across regions with seed data — v1.1

- ✓ CheckIn ElectroDB entity with GPS samples, indexes, and atomic counter side-effects — v1.2
- ✓ Check-in API routes with quota enforcement, pagination, privacy toggle — v1.2
- ✓ CheckInModal with browser GPS collection, mini map preview, privacy select — v1.2
- ✓ Profile check-in display with Leaflet map, numbered markers, accuracy circles, age coloring — v1.2
- ✓ Strava OAuth auto-linking from profile page — v1.2

### Active

(None — run `/gsd:new-milestone` to define next milestone requirements)

### Out of Scope

- Firmware version picker UI — app uses 1-2 DCR34-pinned versions, no user choice
- Custom firmware builds — stock Meshtastic firmware only
- Firefox/Safari support — Web Serial API is Chrome/Edge only
- MQTT broker provisioning — assumes mosquitto is already deployed
- BLE flashing — USB Web Serial is faster and more reliable for initial provisioning
- Offline/PWA mode — requires auth and per-user config (both online)
- run.human dashboard UI for events/routes — separate milestone
- Participant-facing CMS pages — CMS is organizer-only, run.human renders for participants

## Context

- **Monorepo:** 5 apps (run.human, run.auth, run.gpx, run.flash, run.cms) + shared infra
- **CMS stack:** Strapi 5.6, SQLite + Litestream (S3 backup), S3 uploads, SES email
- **CMS auth:** strapi-plugin-sso with OIDC to auth.defcon.run, `cms` service claim required
- **CMS state:** OIDC SSO working, health endpoint, S3/SES configured, Event/Route/POI content types live
- **CMS deployment:** Already deployed to cms.defcon.run via ECS Fargate + CloudFront
- **Flash app:** ~4,900 LOC TypeScript in `apps/run.flash/webapp/src/`
- **Known pattern:** basePath/region prefix handling in Next.js requires systematic review of all absolute paths

## Constraints

- **CMS stack:** Strapi 5.6 — content types defined via schema.json in `src/api/`
- **Auth:** OIDC client to `auth.defcon.run` — cms service claim gates access
- **Storage:** S3 for media (photos, GPX files, videos, blobs) via Strapi upload provider
- **Database:** SQLite (single-writer) — adequate for organizer-only CMS
- **Deploy:** Multi-region ECS Fargate + CloudFront at `cms.defcon.run`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vendor firmware into Docker image | Zero runtime dependency on GitHub; reliable at event time | ✓ Good — 3-stage build works cleanly |
| Multi-region deployment | Consistency with all other DCR34 apps | ✓ Good — same patterns, same scripts |
| Use run.human internal API for MQTT creds | OIDC subject ≠ DynamoDB adapter userId; direct DB access fails | ✓ Good — clean service boundary |
| Gate unsupported browsers at entry | Better UX than discovering inability at flash step | ✓ Good |
| Flash service claim check | Gate access like gpxstudio | ✓ Good — consistent authorization model |
| Many-to-many events↔routes | Routes reused across events, events have multiple routes | — Pending |
| Standalone POIs | Reusable landmarks across multiple routes | — Pending |
| Branded CMS login page | Consistent DCR34 UX, hide raw Strapi admin login | — Pending |
| CMS serves API only, run.human renders | Clean separation of content management and presentation | — Pending |
| CheckIn uses gsi2+gsi3 to avoid RunUser gsi1 collision | Keeps entity indexes clean | ✓ Good |
| Two-phase GPS modal: auto-collect then user-review | Better UX than single-step submit | ✓ Good |
| Relative age coloring for map markers | Visual distinction without absolute time dependency | ✓ Good |
| Strava autoLink param for seamless OAuth | Eliminates extra button click on auth server | ✓ Good |

---
*Last updated: 2026-03-06 after v1.2 milestone completion*
