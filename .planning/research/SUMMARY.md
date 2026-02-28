# Research Summary: DCR34 Meshtastic Flasher

**Domain:** Browser-based ESP32 firmware flasher + Meshtastic device configurator
**Researched:** 2026-02-28
**Overall confidence:** HIGH

## Executive Summary

Building a browser-based ESP32 flasher and Meshtastic configurator is a well-trodden path. The Meshtastic project itself operates an official web flasher at flasher.meshtastic.org (Vue/Nuxt-based) and even has a dedicated "events" variant (`web-flasher-events`) that validates this exact use case. The core libraries -- `esptool-js` for flashing and `@meshtastic/core` + `@meshtastic/transport-web-serial` for configuration -- are actively maintained, well-documented, and proven in production.

The technical risk is low. The libraries are stable (esptool-js 0.5.7, @meshtastic/core 2.6.7), the Web Serial API is mature in Chrome/Edge (since version 89, now at 145+), and there is extensive reference code in the Meshtastic web flasher repository to follow. The primary complexity is not in the libraries themselves but in the orchestration: managing the serial port handoff between the flashing phase (esptool.js) and the configuration phase (@meshtastic/core), and handling the various error states that arise from physical hardware interaction.

The fact that this is a Next.js app (matching the monorepo) rather than the Vue/Nuxt stack used by the upstream Meshtastic flasher is a non-issue. The core libraries are framework-agnostic -- they operate on Web Serial ports and binary data. The framework only matters for the UI wrapper (wizard steps, progress bars, device picker), which is standard React component work.

The only area requiring careful attention is the firmware vendoring strategy. The design document calls for vendoring firmware into the Docker image, which eliminates runtime GitHub dependencies but requires a build-time download step. The firmware file structure (per-device .bin files organized by architecture and version) is well-documented, and the URL patterns are stable.

## Key Findings

**Stack:** esptool-js 0.5.7 (flash) + @meshtastic/core 2.6.7 (configure) + @zip.js/zip.js 2.8.21 (firmware extraction). All actively maintained, all used by Meshtastic's own flasher.

**Architecture:** Two-phase serial port usage -- esptool.js owns the port during flash, then hands off to @meshtastic/core for configuration. The port object persists across close/reopen cycles.

**Critical pitfall:** Serial port handoff between flash and configure phases. Must fully release esptool.js transport, wait for device reboot (~2-3 seconds), then reconnect via @meshtastic/transport-web-serial at 115200 baud.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Phase 1: Device Picker + Browser Gate** - Lowest risk, no hardware needed
   - Addresses: Browser detection, device database, filtering UI
   - Avoids: Any serial port complexity in initial phase

2. **Phase 2: Flash Engine** - Core value, highest technical complexity
   - Addresses: Web Serial connection, esptool.js integration, firmware loading, progress UI
   - Avoids: Configuration complexity (separate concern)

3. **Phase 3: Configuration Engine** - Second core value, depends on working flash
   - Addresses: @meshtastic/core integration, MQTT/channel/identity/radio config push
   - Avoids: Coupling flash and config in same phase

4. **Phase 4: Server-Side Config API + Auth** - Security layer
   - Addresses: /api/config route, OIDC auth, PSK/MQTT credential serving
   - Avoids: Premature auth integration before core flow works

5. **Phase 5: Deployment + Firmware Vendoring** - Production readiness
   - Addresses: Docker build with firmware, Terragrunt service, CloudFront
   - Avoids: Deployment complexity during development

**Phase ordering rationale:**
- Phase 1 can be developed and tested without physical hardware
- Phase 2 requires a physical ESP32 but no auth or server-side config
- Phase 3 requires Phase 2 (device must be flashed before configuration)
- Phase 4 can be developed in parallel with Phase 3 but must be integrated before production
- Phase 5 is deployment -- standard monorepo pattern, low risk

**Research flags for phases:**
- Phase 2: May need deeper research on partition offsets per device/flash size
- Phase 3: May need deeper research on exact protobuf config shapes for Meshtastic 2.7.x
- Phase 5: Standard DCR34 deployment pattern, unlikely to need research

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All libraries verified on npm with recent publish dates. API surface confirmed from official docs and source code. |
| Features | HIGH | Feature set is well-defined in design doc and mirrors existing Meshtastic web flasher. |
| Architecture | HIGH | Two-phase serial port pattern verified from Meshtastic web flasher source code. |
| Pitfalls | MEDIUM | Serial port edge cases and hardware-specific issues are numerous. Listed known ones, but physical hardware testing will surface more. |

## Gaps to Address

- Exact Meshtastic firmware version to pin for DCR34 (event decision, not technical research)
- Protobuf config shapes may evolve between @meshtastic/core 2.6.x and whatever version ships with the pinned firmware
- Hardware-specific quirks (CH340 driver issues, ESP32-C3 USB-JTAG timeout) need testing with actual devices
- The Meshtastic `web-flasher-events` repo uses a special `event/` path for firmware -- we should evaluate whether to use this mechanism or our own vendoring
