# DCR34 Meshtastic Flasher — Design Document

**Date:** 2026-02-28
**App:** `flash.defcon.run` (`apps/run.flash`)
**Status:** Approved

## Problem

DEF CON Run 34 participants need Meshtastic radios configured for the event's mesh network. Currently this requires manually flashing firmware, then configuring MQTT, channels, PSK, and identity settings through the Meshtastic app or CLI. This is error-prone and creates support burden at the event.

## Solution

A web-based flasher at `flash.defcon.run` that lets authenticated participants flash and fully provision an ESP32 Meshtastic device in one browser session. The tool flashes DCR34-vetted firmware via Web Serial, then automatically pushes the user's personalized configuration (MQTT credentials, channel PSK, identity, radio settings) onto the device.

## Architecture

```
┌─────────────────────────────────────────────┐
│  flash.defcon.run (Next.js 16 / React 19)   │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │  Device   │  │  Flash   │  │ Configure │ │
│  │  Picker   │→ │  Step    │→ │   Step    │ │
│  └──────────┘  └──────────┘  └───────────┘ │
│       ↓              ↓             ↓        │
│  hardware-     esptool.js    @meshtastic/   │
│  list.json    (Web Serial)   core + web-    │
│  (vendored)                  serial         │
│       ↓                            ↓        │
│  Meshtastic                  Config from:   │
│  GitHub raw                  - Server-side  │
│  firmware                      user config  │
│                              - MQTT creds   │
│                              - Channel PSK  │
└─────────────────────┬───────────────────────┘
                      │ OIDC
              ┌───────┴───────┐
              │ auth.defcon.run│
              └───────┬───────┘
                      │ optional
              ┌───────┴───────┐
              │ run.defcon.run │
              │ (radio reg)   │
              └───────────────┘
```

## User Flow

1. **Authenticate** — OIDC login via `auth.defcon.run`
2. **Pick device** — Browse/filter ESP32 devices from the Meshtastic hardware database (images, names, support tiers)
3. **Connect** — Plug in USB, browser Web Serial prompt
4. **Flash** — `esptool.js` writes DCR34-pinned Meshtastic firmware (chip auto-detected from device selection)
5. **Configure** — `@meshtastic/core` pushes config via Web Serial:
   - **MQTT:** `mqtt.defcon.run` endpoint, port, TLS, per-user credentials
   - **Channels:** DCR34 primary channel + PSK, defcon.org bridge channel
   - **Identity:** Long/short name from DCR34 profile, nodeId
   - **Radio:** LoRa region (US), modem preset, hop limit
6. **Optional register** — Offer to link the radio in run.human's Meshtastic radio system

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16, React 19 | Matches monorepo |
| UI | HeroUI, Tailwind 4 | Consistent with run.human |
| Flashing | `esptool.js` | Espressif's official JS port, same lib used by upstream Meshtastic flasher |
| Configuration | `@meshtastic/core`, `@meshtastic/transport-web-serial` | Official Meshtastic JS library |
| Auth | OIDC client → `auth.defcon.run` | Same pattern as run.human |
| Deploy | ECS Fargate, CloudFront | Existing pipeline |

## Device Database

Vendor Meshtastic's [`hardware-list.json`](https://github.com/meshtastic/web-flasher/blob/main/public/data/hardware-list.json) (~122 devices). Filter to ESP32 architectures only (`esp32`, `esp32-s3`, `esp32-c3`, `esp32-c6`). Each entry provides:

- `hwModel` / `hwModelSlug` — device identifier
- `platformioTarget` — maps to firmware binary filename
- `architecture` — chip family (used for filtering + firmware selection)
- `displayName` — user-facing name
- `tags` — manufacturer (RAK, LilyGo, Heltec, etc.)
- `images` — SVG device images
- `activelySupported` / `supportLevel` — for sorting/filtering

The JSON is vendored into the app (not fetched at runtime) and updated manually when the pinned firmware version changes.

## Firmware

- **No build pipeline.** Stock Meshtastic firmware, fetched from GitHub raw content.
- **Pinned versions.** 1-2 vetted firmware versions chosen for DCR34. No version picker UI — the app knows which version(s) to use.
- **URL pattern:** `https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/firmware-{version}/` contains per-platform firmware ZIPs (e.g., `firmware-esp32-{version}.zip`).
- **Firmware ZIPs** contain per-device `.bin` files named by `platformioTarget` (e.g., `firmware-heltec-v3-{version}.bin`).

## Configuration Details

After flashing, the app connects to the device via `@meshtastic/core` over Web Serial and pushes:

### MQTT Config
- **Server:** `mqtt.defcon.run`
- **Port:** TLS port (TBD, likely 8883)
- **Username/Password:** Per-user credentials (derived from authenticated identity)
- **Encryption:** TLS enabled
- **Root topic:** DCR34 mesh topic prefix

### Channel Config
- **Primary channel:** DCR34 event channel with PSK
- **Secondary channel(s):** Bridge to defcon.org public channels
- **PSK:** Event-wide pre-shared key (served from server-side config, not hardcoded in client)

### Identity Config
- **Long name:** User's DCR34 display name
- **Short name:** Abbreviated name (4 chars)
- **NodeId:** If user has a registered radio in run.human, use that nodeId

### Radio Config
- **Region:** `US` (covers both US and CA DEF CON Run regions)
- **Modem preset:** TBD (event-appropriate preset)
- **Hop limit:** TBD (event-appropriate value)

## API Routes

### `GET /api/config`
Returns the authenticated user's device configuration payload. Server-side only — PSK, MQTT credentials, and channel config are never exposed in client-side code.

**Response:**
```json
{
  "mqtt": {
    "server": "mqtt.defcon.run",
    "port": 8883,
    "username": "user-abc123",
    "password": "generated-credential",
    "tls": true,
    "root": "dcr34"
  },
  "channels": [
    { "name": "DCR34", "psk": "base64-psk", "role": "PRIMARY" },
    { "name": "defcon", "psk": "base64-psk", "role": "SECONDARY" }
  ],
  "identity": {
    "longName": "Runner Alice",
    "shortName": "ALIC"
  },
  "radio": {
    "region": "US",
    "modemPreset": "LONG_FAST",
    "hopLimit": 3
  }
}
```

### `POST /api/register` (optional)
Proxies radio registration to run.human's Meshtastic radio API.

**Request:** `{ "nodeId": "!aabbccdd" }`
**Response:** `{ "registered": true, "radioId": "..." }`

## Security Considerations

- **PSK and MQTT credentials are server-side only.** The client fetches them per-session via authenticated API call, never bundled in client JS.
- **OIDC auth required.** No anonymous access to flash or configure.
- **Per-user MQTT credentials.** Each user gets unique MQTT auth (generation mechanism TBD, likely derived from user ID + shared secret or provisioned in mosquitto).
- **Web Serial requires HTTPS.** Production deployment on CloudFront satisfies this. Local dev needs `localhost` (exempt) or self-signed cert.
- **No firmware modification.** Stock Meshtastic firmware — configs are pushed post-flash, not baked in.

## Browser Requirements

- **Chrome or Edge** (Web Serial API required — not supported in Firefox or Safari)
- **HTTPS** (required for Web Serial)
- **USB connection** to ESP32 device

## What's NOT Custom Code

| Component | Source |
|-----------|--------|
| Device database | Meshtastic `hardware-list.json` (vendored) |
| Firmware binaries | Meshtastic GitHub releases |
| Flashing engine | `esptool.js` |
| Device configuration protocol | `@meshtastic/core` |
| Auth | Existing OIDC infrastructure |
| Deploy pipeline | Existing ECS/CloudFront pattern |

## What IS Custom Code

- Device picker UI (React components rendering hardware-list.json)
- Step-by-step wizard flow (pick → connect → flash → configure → done)
- `/api/config` route (generates per-user Meshtastic config from auth identity + server-side secrets)
- Optional `/api/register` proxy to run.human radio registration
- Flash progress UI wrapping esptool.js
- Configure progress UI wrapping @meshtastic/core

## Deployment

Same pattern as other DCR34 apps:

- `apps/run.flash/webapp/` — Next.js application
- `apps/run.flash/Dockerfile.webapp` + `Dockerfile.nginx` — sidecar build
- Terragrunt service definition at `infra/terraform/live/site/services/flash/`
- CloudFront distribution at `flash.defcon.run`
- Multi-region deployment via `release-all.sh`

## Open Questions

- **MQTT credential provisioning:** How are per-user mosquitto credentials generated? Options: derived from user ID + HMAC, provisioned via mosquitto dynamic security plugin, or pre-generated during auth.
- **Firmware version pinning:** Exact Meshtastic version(s) to vet for DCR34.
- **Radio presets:** Modem preset and hop limit values for the event.
- **Channel PSK:** How/where the event PSK is managed.
- **Bridge channels:** Exact defcon.org channel names and PSKs for bridging.
