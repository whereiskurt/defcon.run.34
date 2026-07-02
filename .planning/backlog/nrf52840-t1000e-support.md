---
title: nRF52840 flash support (Seeed T1000-E card tracker)
captured: 2026-07-01
promoted: 2026-07-01 — Kurt confirmed v1.4.1 promotion, parallel with v1.5 bib
source: v1.4 Phase 19 close-out conversation with Kurt
status: scoped-in-roadmap (see ROADMAP.md Phases 24-25 under v1.4.1)
milestone: v1.4.1 nRF52840 / T-1000E Flash Support
parallel_with: v1.5 Bib Registration (no file overlap — flash vs bib codebases)
scope: 2 phases, ~3 plans total
fast_follow: no — architecturally different flash path from ESP32
---

# nRF52840 flash support (Seeed T1000-E card tracker)

## Why we want it

The Seeed T1000-E "SenseCap Card Tracker" is an increasingly popular Meshtastic node
that DCR34 runners may bring — but the current flasher explicitly filters it out at
build time. Adding support unblocks non-ESP32 devices without breaking the ESP32 path.

## Why it is NOT a fast follow

Every other Recommended device in the flasher today is an ESP32 family part
(esp32 / esp32-s3 / esp32-c3 / esp32-c6) using `esptool-js` over Web Serial.
nRF52840 uses a fundamentally different flash model:

| Layer | ESP32 (current) | nRF52840 (needed) |
|-------|-----------------|-------------------|
| Bootloader entry | Hold BOOT + tap RST | Double-tap RST → mass-storage / DFU |
| Flash target | `.factory.bin` at `0x0` | `.uf2` drop OR `.zip` DFU package |
| Web API | Web Serial (`@meshtastic/transport-web-serial`) | Web USB DFU OR File System Access API (UF2 drop) |
| JS library | `esptool-js` | `web-dfu` / custom UF2 writer / `nrf-dfu-js` |
| Verify | `flashMd5sum(0x0, size)` | Post-drop / DFU-status |

So this is not "add one slug" — it's a new device-family branch in `use-flash.ts`
plus a new UX (bootloader-help copy, connect flow), plus a new build-time firmware
extraction (Meshtastic ships `firmware-t1000-e-{version}.uf2` alongside the
`.factory.bin` set).

## Scope sketch (2-3 plans)

1. **Plan N-01** — device-family router + hardware-list expansion
   - Unblock `nrf52840` in `Dockerfile.webapp` Stage 1 jq filter (add to the ESP32 architecture set)
   - Add a `family` discriminator to `RECOMMENDED_SLUGS` entries or derive from
     `deviceHardware.architecture`
   - Router in `use-flash.ts` that dispatches ESP32 → esptool-js path (unchanged) vs.
     nRF52 → new UF2/DFU path

2. **Plan N-02** — nRF52 flash path
   - Extract `.uf2` from the Meshtastic release zip in `Dockerfile.webapp` Stage 1
     (currently only extracts `.factory.bin`)
   - Implement one of: Web USB DFU write (Adafruit UF2 bootloader exposes DFU), OR
     File System Access API drop (user must confirm mass-storage device)
   - MD5/post-flash verify strategy for nRF (DFU responds with status; UF2 drop is fire-and-forget)

3. **Plan N-03** — UX polish
   - New bootloader-help variant: "Double-tap the reset button — device shows up as a
     USB drive named `FTHR840BOOT` (or similar)"
   - Update chip-mismatch to include nRF52 chip families
   - Verify existing four connect-error categories still cover the nRF path

## Hardware-in-loop asks (blocking)

- Boot check: T1000-E flashes cleanly and joins the mesh after reset
- Regression: at least one ESP32 device from the Recommended set still flashes with no
  copy or UX regression from the new router

## Not in scope

- iOS/Android web-USB DFU support (Web USB is desktop-only for now)
- OTA firmware updates for already-provisioned nRF devices
- Meshtastic reset/erase flow for nRF (rely on bootloader default state)

## Related

- Phase 18: build-time firmware & device-list refresh (ESP32-only filter installed)
- Phase 19: esptool-js 0.6.0 bump + branding (`use-flash.ts` is now the ESP32 flash path;
  refactor to router would live here)
