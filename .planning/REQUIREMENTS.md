# Requirements: DCR34 Meshtastic Flasher (flash.defcon.run)

**Defined:** 2026-02-28
**Core Value:** A participant can go from unboxed ESP32 to fully provisioned DCR34 mesh radio in a single browser session, with zero manual configuration steps.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Browser & Entry

- [x] **BRWS-01**: App detects Web Serial API support and gates unsupported browsers at page load with clear "use Chrome or Edge" message and download links
- [x] **BRWS-02**: App enforces OIDC authentication — unauthenticated users redirect to auth.defcon.run

### Device Selection

- [x] **DEVC-01**: User can browse ESP32 devices from vendored Meshtastic hardware-list.json filtered to ESP32 architectures only
- [x] **DEVC-02**: Device picker displays device images (SVGs), display names, and manufacturer tags
- [x] **DEVC-03**: User can filter/search devices by name or manufacturer
- [x] **DEVC-04**: Device picker shows support tier and actively-supported status for sorting
- [x] **DEVC-05**: Selecting a device determines the correct firmware binary filename via platformioTarget

### USB Connection

- [ ] **CONN-01**: User can initiate Web Serial connection via browser prompt (user-initiated gesture required)
- [ ] **CONN-02**: App handles connection failures with actionable error messages
- [ ] **CONN-03**: App provides device-specific bootloader guidance (hold BOOT, press RESET) when connection fails

### Firmware Flashing

- [ ] **FLSH-01**: App performs full erase before flashing (fresh provisioning, not update)
- [ ] **FLSH-02**: App flashes DCR34-pinned Meshtastic firmware via esptool.js over Web Serial
- [ ] **FLSH-03**: Flash progress is displayed with percentage and meaningful status text (erasing, writing, verifying)
- [ ] **FLSH-04**: Flash completion shows clear success or failure state with actionable guidance on failure
- [ ] **FLSH-05**: Firmware binaries are vendored into the Docker image — zero runtime external dependencies

### Post-Flash Configuration

- [ ] **CONF-01**: After flash, app reconnects to device via @meshtastic/core over Web Serial (handles reboot delay, retry logic)
- [ ] **CONF-02**: App pushes MQTT config to device: server (mqtt.defcon.run), port, TLS, per-user credentials from RunUser entity
- [ ] **CONF-03**: App pushes channel config to device: DCR34 primary channel with PSK, bridge channels
- [ ] **CONF-04**: App pushes identity config to device: long name and short name from authenticated user's DCR34 profile
- [ ] **CONF-05**: App pushes radio config to device: LoRa region (US), modem preset, hop limit
- [ ] **CONF-06**: Configuration push uses transactional edit (beginEditSettings / commitEditSettings) for atomic apply
- [ ] **CONF-07**: Configuration progress is displayed with per-step status

### Server-Side Config

- [ ] **SRVR-01**: GET /api/config returns authenticated user's device configuration payload (MQTT creds, channels, PSK, identity, radio)
- [ ] **SRVR-02**: PSK, MQTT credentials, and channel config are never exposed in client-side JS bundles — served via authenticated API only
- [ ] **SRVR-03**: All TBD config values (MQTT server, channel PSKs, radio presets) are environment/config-driven with stub defaults

### Wizard Flow

- [x] **WZRD-01**: Step-by-step wizard: Pick Device → Connect → Flash → Configure → Done
- [x] **WZRD-02**: Each step validates completion before allowing progression to next step
- [x] **WZRD-03**: Progress breadcrumb shows current position in the flow
- [ ] **WZRD-04**: Done screen shows success confirmation with device identity and next steps

### Deployment

- [ ] **DPLY-01**: App follows monorepo pattern: apps/run.flash/webapp/ with Dockerfile.webapp + Dockerfile.nginx
- [ ] **DPLY-02**: Terragrunt service definition at infra/terraform/live/site/services/flash/
- [ ] **DPLY-03**: CloudFront distribution at flash.defcon.run
- [ ] **DPLY-04**: Multi-region deployment following standard DCR34 pattern (us-east-1, ca-central-1, ap-southeast-1) with flash.defcon.run defaulting to /use1/
- [ ] **DPLY-05**: Build-time firmware vendoring: download, extract, and bundle firmware binaries into Docker image

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Integration

- **INTG-01**: Optional radio registration from flasher — link flashed device to run.human's Meshtastic radio system
- **INTG-02**: Post-flash "Register in DCR34" link pointing to run.human

### Polish

- **PLSH-01**: Config verification via device read-back after pushing
- **PLSH-02**: Error recovery with automatic retry for each configuration step
- **PLSH-03**: Serial monitor / debug console for advanced users

## Out of Scope

| Feature | Reason |
|---------|--------|
| Firmware version picker | DCR34 pins 1-2 vetted versions; version choice confuses novice users |
| Custom firmware builds | Stock Meshtastic firmware only — not the problem we're solving |
| BLE flashing | USB Web Serial is faster and more reliable for initial provisioning |
| Firefox/Safari support | Web Serial API is Chromium-only, no polyfill exists |
| Single-region deployment | Follows standard DCR34 multi-region pattern for consistency |
| Device auto-detection | Need exact board model (not just chip family) for correct firmware selection |
| Offline/PWA mode | Requires auth (online) and per-user config (online); vendored firmware handles GitHub-down scenario |
| Advanced flash settings | Baud rate, flash mode, memory addresses are footguns for non-technical users |
| Internationalization | English-only for Las Vegas DEF CON event |
| Serial monitor | Available in upstream flasher.meshtastic.org |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRWS-01 | Phase 1 | Complete |
| BRWS-02 | Phase 1 | Complete |
| DEVC-01 | Phase 1 | Complete |
| DEVC-02 | Phase 1 | Complete |
| DEVC-03 | Phase 1 | Complete |
| DEVC-04 | Phase 1 | Complete |
| DEVC-05 | Phase 1 | Complete |
| WZRD-01 | Phase 1 | Complete |
| WZRD-02 | Phase 1 | Complete |
| WZRD-03 | Phase 1 | Complete |
| CONN-01 | Phase 2 | Pending |
| CONN-02 | Phase 2 | Pending |
| CONN-03 | Phase 2 | Pending |
| FLSH-01 | Phase 2 | Pending |
| FLSH-02 | Phase 2 | Pending |
| FLSH-03 | Phase 2 | Pending |
| FLSH-04 | Phase 2 | Pending |
| FLSH-05 | Phase 2 | Pending |
| CONF-01 | Phase 3 | Pending |
| CONF-02 | Phase 3 | Pending |
| CONF-03 | Phase 3 | Pending |
| CONF-04 | Phase 3 | Pending |
| CONF-05 | Phase 3 | Pending |
| CONF-06 | Phase 3 | Pending |
| CONF-07 | Phase 3 | Pending |
| SRVR-01 | Phase 3 | Pending |
| SRVR-02 | Phase 3 | Pending |
| SRVR-03 | Phase 3 | Pending |
| WZRD-04 | Phase 3 | Pending |
| DPLY-01 | Phase 4 | Pending |
| DPLY-02 | Phase 4 | Pending |
| DPLY-03 | Phase 4 | Pending |
| DPLY-04 | Phase 4 | Pending |
| DPLY-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation*
