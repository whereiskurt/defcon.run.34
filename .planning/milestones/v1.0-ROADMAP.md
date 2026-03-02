# Roadmap: DCR34 Meshtastic Flasher (flash.defcon.run)

## Overview

This roadmap delivers a browser-based ESP32 flasher and Meshtastic device provisioner for DEF CON Run 34. The journey moves from a hardware-free app scaffold with device browsing, through the two core serial-port phases (flash then configure), to production deployment. Each phase delivers a complete, testable vertical slice: first a working app shell with device selection, then actual firmware flashing, then device configuration with server-side secrets, and finally production infrastructure with vendored firmware.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: App Scaffold + Device Picker** - Next.js app with auth, browser gate, device picker UI, and wizard shell
- [ ] **Phase 2: Flash Engine** - Web Serial connection, esptool.js firmware flashing with progress UI
- [ ] **Phase 3: Config Engine + Server API** - Post-flash device configuration via @meshtastic/core, authenticated config API, completion screen
- [ ] **Phase 4: Deployment + Firmware Vendoring** - Docker build with vendored firmware, Terragrunt service, CloudFront at flash.defcon.run

## Phase Details

### Phase 1: App Scaffold + Device Picker
**Goal**: Users can browse and select their ESP32 device in a guided wizard, with unsupported browsers blocked and unauthenticated users redirected
**Depends on**: Nothing (first phase)
**Requirements**: BRWS-01, BRWS-02, DEVC-01, DEVC-02, DEVC-03, DEVC-04, DEVC-05, WZRD-01, WZRD-02, WZRD-03
**Success Criteria** (what must be TRUE):
  1. A user visiting flash.defcon.run in Firefox sees a clear "use Chrome or Edge" message and cannot proceed
  2. A user visiting in Chrome without being logged in is redirected to auth.defcon.run and returned after login
  3. An authenticated user can browse ESP32 devices with images and manufacturer tags, and filter by name or manufacturer
  4. Selecting a device advances the wizard to the "Connect" step, and the correct firmware filename is determined from the selection
  5. A progress breadcrumb shows the user's current position across all wizard steps (Pick Device / Connect / Flash / Configure / Done)
**Plans:** 2/2 plans complete

Plans:
- [x] 01-01-PLAN.md -- Bootstrap Next.js 16 app with OIDC authentication via auth.defcon.run
- [x] 01-02-PLAN.md -- Browser gate, wizard flow, and interactive device picker UI

### Phase 2: Flash Engine
**Goal**: Users can connect their ESP32 via USB and flash DCR34-pinned Meshtastic firmware with real-time progress feedback
**Depends on**: Phase 1
**Requirements**: CONN-01, CONN-02, CONN-03, FLSH-01, FLSH-02, FLSH-03, FLSH-04, FLSH-05
**Success Criteria** (what must be TRUE):
  1. User can click "Connect" and select their ESP32 from the browser's serial port prompt
  2. If connection fails, user sees an actionable error message with device-specific bootloader guidance (hold BOOT, press RESET)
  3. After connecting, firmware is erased and flashed with a progress bar showing percentage and status text (erasing, writing, verifying)
  4. Flash completion shows clear success or failure, with retry guidance on failure
  5. Firmware binaries are served from the app (not fetched from GitHub at runtime)
**Plans**: 1/2 plans complete

Plans:
- [x] 02-01-PLAN.md -- Install esptool.js, serial/flash types, firmware config, useSerial and useFlash hooks
- [ ] 02-02-PLAN.md -- Connect step UI, Flash step UI with pipeline, wire into wizard container

### Phase 3: Config Engine + Server API
**Goal**: After flashing, the app automatically configures the device with the user's MQTT credentials, DCR34 channels, identity, and radio settings -- all served securely from the server
**Depends on**: Phase 2
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06, CONF-07, SRVR-01, SRVR-02, SRVR-03, WZRD-04
**Success Criteria** (what must be TRUE):
  1. After flash completes, the app reconnects to the device via @meshtastic/core (handling reboot delay) and pushes all configuration atomically
  2. User sees per-step progress as MQTT, channel, identity, and radio configs are pushed to the device
  3. GET /api/config returns the authenticated user's complete config payload; PSK and MQTT credentials are never present in client-side JS bundles
  4. Configuration values (MQTT server, channel PSKs, radio presets) are environment-driven with stub defaults for development
  5. The "Done" screen shows success confirmation with the device's identity and next steps
**Plans**: 3/3 plans complete

Plans:
- [x] 03-01-PLAN.md -- Server-side foundation: types, config, DynamoDB entities, /api/config endpoint
- [x] 03-02-PLAN.md -- @meshtastic/core wrapper library and useConfigure hook for config push pipeline
- [x] 03-03-PLAN.md -- ConfigureStep UI, DoneStep UI, wire into WizardContainer

### Phase 4: Deployment + Firmware Vendoring
**Goal**: The app is deployed to production at flash.defcon.run with firmware binaries baked into the Docker image and zero runtime external dependencies
**Depends on**: Phase 3
**Requirements**: DPLY-01, DPLY-02, DPLY-03, DPLY-04, DPLY-05
**Success Criteria** (what must be TRUE):
  1. The app lives at apps/run.flash/webapp/ with Dockerfile.webapp and Dockerfile.nginx matching monorepo conventions
  2. Docker build downloads, extracts, and bundles Meshtastic firmware binaries -- the running container has no external dependencies
  3. Terragrunt service definition exists at infra/terraform/live/site/services/flash/ and deploys to all 3 regions (us-east-1, ca-central-1, ap-southeast-1)
  4. flash.defcon.run resolves via CloudFront with region-prefixed paths (/use1/, /cac1/, /apse1/) defaulting to /use1/
**Plans**: 1/2 plans complete

Plans:
- [x] 04-01-PLAN.md -- Docker containerization with firmware vendoring, nginx sidecar, region router
- [ ] 04-02-PLAN.md -- Infrastructure registration (service.hcl, site.hcl, CloudFront, scripts)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. App Scaffold + Device Picker | 2/2 | Complete    | 2026-02-28 |
| 2. Flash Engine | 1/2 | In Progress | - |
| 3. Config Engine + Server API | 3/3 | Complete | 2026-02-28 |
| 4. Deployment + Firmware Vendoring | 1/2 | In Progress | - |
