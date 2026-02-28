# Domain Pitfalls: Browser-Based ESP32 Meshtastic Flasher

**Domain:** Web-based ESP32 firmware flasher and device provisioner
**Project:** flash.defcon.run (DCR34 Meshtastic Flasher)
**Researched:** 2026-02-28

---

## Critical Pitfalls

Mistakes that cause showstopper failures, bricked devices, or event-day chaos.

### Pitfall 1: Chrome Version Breaking Web Serial Mid-Event

**What goes wrong:** Chrome auto-updates silently. A Chrome release ships a Web Serial API regression that breaks esptool.js connectivity. Users arrive at DEF CON, open flash.defcon.run, and cannot connect to their devices. This has happened twice in 2025-2026:
- Chrome 139 broke DTR/RTS signal handling on macOS and Linux (bad `ioctl()` pointer in `SerialSplitDtrAndRts` feature). Windows was unaffected.
- Chrome 143 broke ESP32-S2 connections with timing changes causing "Invalid head of packet" errors.

**Why it happens:** Chromium's Web Serial implementation is actively evolving. The API surface is small but touches OS-level serial drivers. Minor internal refactors cause platform-specific breakage that Chromium's test suite does not catch for all chip variants.

**Consequences:** Complete inability to flash devices for affected users. No workaround exists that users can self-service at an event (launching Chrome with `--disable-features=SerialSplitDtrAndRts` is not realistic for non-technical users).

**Prevention:**
- Pin a known-good Chrome version in documentation and pre-event communications. Test against Chrome Canary monthly in the months before DEF CON.
- Test the full flash flow on macOS, Windows, and Linux before the event with the Chrome version that will be current at event time (DEF CON 34 is August 2026 -- test against Chrome ~128-130 era).
- Build a "browser compatibility check" into the app that reports Chrome version and runs a quick Web Serial smoke test before entering the wizard flow.
- Have a fallback plan: keep the Python `device-install.sh` CLI script available for volunteers to flash devices if the web flasher breaks.

**Detection:** Automated CI that runs esptool.js connection tests against Chrome Canary weekly. Any failure is an early warning.

**Phase:** Phase 1 (core infrastructure). Browser detection and version checking should be the very first gate in the wizard.

**Confidence:** HIGH -- Chrome 139 and 143 breakages are documented in esptool-js issues [#206](https://github.com/espressif/esptool-js/issues/206) and [#227](https://github.com/espressif/esptool-js/issues/227).

---

### Pitfall 2: Serial Port State Corruption During Flash-to-Configure Handoff

**What goes wrong:** After esptool.js finishes flashing firmware, the serial port is in a specific state (baud rate, DTR/RTS signal levels, stream locks). The app then needs to close that connection and open a new one with `@meshtastic/core` to push configuration. This handoff fails because:
1. The readable/writable streams from esptool.js are still locked, preventing `port.close()`.
2. The device reboots after flash and re-enumerates on the USB bus, sometimes as a different port.
3. The device needs 5-15 seconds to fully boot Meshtastic firmware before it accepts protobuf commands, but there is no reliable "ready" signal.
4. On some ESP32-S3/C3 devices using USB_SERIAL_JTAG (no external UART chip), the device disappears from the USB bus entirely during reboot and reappears as a new device.

**Why it happens:** esptool.js and `@meshtastic/core` are independent libraries with no shared state. esptool.js was designed for "flash and done." Meshtastic's JS library was designed for "connect to an already-running device." Nobody designed the handoff between them.

**Consequences:** The user sees flash succeed at 100%, then the configure step fails silently or with a cryptic "port not open" error. They are stuck with a flashed but unconfigured device -- the worst outcome because they think they are done but the device has no MQTT/channel/identity config.

**Prevention:**
- After esptool.js completes, explicitly release all stream locks (`reader.releaseLock()`, `writer.releaseLock()`), close the port, and wait.
- After closing the port, add a mandatory delay (minimum 10 seconds, ideally with a visual countdown: "Device is rebooting...") before attempting to reconnect.
- For USB_SERIAL_JTAG devices (ESP32-S3, C3, C6): listen for `navigator.serial` `disconnect` and `connect` events to detect the device re-enumerating. Prompt the user to re-select the port if needed.
- Implement a connection retry loop with exponential backoff (try every 2s, up to 30s) when opening the port for configuration.
- Show clear UI state: "Flashing complete. Waiting for device to restart..." with a progress indicator, not a blank screen.
- Use `@meshtastic/core`'s `startConfig` handshake to confirm the device is actually ready before pushing config.

**Detection:** If the configure step fails within 5 seconds of flash completing, it is almost certainly this handoff issue, not a device problem.

**Phase:** Phase 2 (flash step) and Phase 3 (configure step). This lives at the boundary between them and must be designed explicitly as a "transition state" in the wizard.

**Confidence:** HIGH -- multiple Meshtastic web-flasher issues document this pattern; the "port is already open" error is the #1 reported post-flash issue ([meshtastic/web-flasher#144](https://github.com/meshtastic/web-flasher/issues/144)).

---

### Pitfall 3: Wrong Firmware Binary for Device Hardware

**What goes wrong:** The user selects "Heltec V3" in the device picker, but the firmware binary flashed is for "Heltec V2" (different chip architecture) or the wrong variant of V3. The device boots into a crash loop or does not boot at all.

**Why it happens:** The Meshtastic hardware database (`hardware-list.json`) maps `hwModelSlug` to `platformioTarget`, which determines the firmware binary filename. But:
1. Multiple hardware revisions share similar names (Heltec V3 vs V3.1, RAK4631 vs RAK4631-R).
2. The `platformioTarget` naming does not always match the firmware ZIP filenames exactly.
3. New hardware variants are added to the database but the firmware ZIP for the pinned version may not contain binaries for those new devices.
4. ESP32 vs ESP32-S3 firmware ZIPs are separate downloads; selecting from the wrong architecture ZIP gives a binary that will not boot.

**Consequences:** Device appears bricked (crash loop). ESP32 chips are not truly brickable (the ROM bootloader always works), but users at DEF CON will panic and create a support queue. Recovery requires a full erase and reflash -- exactly the situation the flasher was supposed to prevent.

**Prevention:**
- Curate a whitelist of tested device/firmware pairs rather than exposing the full 122-device hardware database. For DCR34, only officially support the 5-10 most common Meshtastic ESP32 devices.
- Validate that every `platformioTarget` in the whitelist has a corresponding `.bin` file in the vendored firmware ZIPs at build time. Fail the Docker build if any mapping is broken.
- Map `architecture` field to the correct firmware ZIP family (`firmware-esp32-*.zip` vs `firmware-esp32s3-*.zip` vs `firmware-esp32c3-*.zip`).
- Add a "confirm your device" step with a photo comparison before flashing begins.
- If possible, read the chip ID after Web Serial connect and cross-reference against the selected device's expected chip family. esptool.js can detect chip type (`ESP32`, `ESP32-S3`, etc.) before flashing -- use this as a safety check.

**Detection:** Build-time validation catches missing binaries. Runtime chip detection catches architecture mismatches. Visual device confirmation catches model confusion.

**Phase:** Phase 1 (device picker) and Phase 2 (flash step). The picker must be curated, and the flash step must validate before writing.

**Confidence:** HIGH -- boot loop issues from wrong firmware are extensively documented in Meshtastic firmware issues ([#3338](https://github.com/meshtastic/firmware/issues/3338), [#2084](https://github.com/meshtastic/firmware/issues/2084), [#4615](https://github.com/meshtastic/firmware/issues/4615)).

---

### Pitfall 4: Firmware/Library Protobuf Version Mismatch

**What goes wrong:** The `@meshtastic/core` npm package used for configuration pushes protobuf messages that the freshly-flashed firmware does not understand, or vice versa. Config push appears to succeed but values are silently ignored or misinterpreted.

**Why it happens:** Meshtastic's protobuf schema evolves between firmware releases. The `@meshtastic/core` package is versioned independently of firmware releases. If the pinned firmware version is 2.5.x but `@meshtastic/core` is built against 2.6.x protobufs, fields may have different indices, new fields may not exist, and enum values may have shifted.

**Consequences:** Configuration is silently wrong. The device connects to the mesh but with wrong channel settings, wrong MQTT credentials, or wrong radio presets. Users think they are configured but their devices do not work on the DCR34 mesh. This is worse than a visible error because it is invisible.

**Prevention:**
- Pin `@meshtastic/core` and `@meshtastic/protobufs` to the exact version that matches the pinned firmware version. Document this coupling explicitly.
- After pushing config, read it back and verify all critical fields (MQTT server, channel PSK, region) match what was sent. Display a verification checkmark for each config category.
- Test the complete flow (flash firmware version X, configure with @meshtastic/core version Y) as a manual QA step every time either version changes.
- Consider using a compatibility matrix document that maps firmware versions to known-compatible npm package versions.

**Detection:** Config verification read-back catches mismatches. If any field does not round-trip correctly, surface a warning to the user.

**Phase:** Phase 3 (configure step). Must be addressed when selecting library versions and tested end-to-end.

**Confidence:** MEDIUM -- version coupling is documented ([`@meshtastic/js` 2.5.9-2 was released specifically to fix protobuf decoding with firmware 2.5.11](https://www.npmjs.com/package/@meshtastic/core)), but the exact failure modes depend on which protobuf fields change between versions.

---

### Pitfall 5: Flash Offset Addresses Wrong for Chip Architecture

**What goes wrong:** esptool.js writes firmware binaries to incorrect flash memory offsets. The bootloader, partition table, and application firmware must be written to specific addresses that differ between ESP32 variants:
- ESP32: bootloader at `0x1000`, partition table at `0x8000`, firmware at `0x10000`
- ESP32-S3: bootloader at `0x0000`, partition table at `0x8000`, firmware at `0x10000`
- ESP32-C3/C6: bootloader at `0x0000`, partition table at `0x8000`, firmware at `0x10000`

Writing to the wrong offset corrupts the flash layout. The device does not boot.

**Why it happens:** Meshtastic's `device-install.sh` script handles this automatically with per-architecture logic. When reimplementing in JavaScript, developers must manually specify these offsets. The Meshtastic firmware ZIP contains a `.bin` file and possibly separate bootloader/partition files, and the developer must know which files go where.

**Consequences:** Device will not boot. Requires full erase and reflash to recover.

**Prevention:**
- Study the Meshtastic web flasher's source code (`github.com/meshtastic/web-flasher`) to understand exactly how it maps architectures to flash offsets.
- Use the `.factory.bin` file from the firmware ZIP when available -- this is a single combined binary that includes bootloader + partition table + firmware at correct offsets, and can be flashed to offset `0x0000`. This eliminates multi-file offset management entirely.
- If using separate files: create an explicit offset map per architecture, validate it against the `device-install.sh` script, and unit test it.
- Always erase flash before a full install (not just an update) to avoid stale partition table conflicts.

**Detection:** After flashing, attempt to connect to the device. If the device does not respond within 30 seconds, the flash offsets are likely wrong.

**Phase:** Phase 2 (flash step). This is core flash logic and must be correct before any device testing.

**Confidence:** HIGH -- flash offset requirements are well-documented in [Espressif's esptool documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/flashing-firmware.html) and ESP-IDF partition table docs.

---

## Moderate Pitfalls

Issues that cause user frustration, support load, or degraded experience but are recoverable.

### Pitfall 6: USB Cable Is Power-Only (No Data)

**What goes wrong:** User connects their ESP32 with a USB cable that carries power but no data lines. The device powers on (LED lights up) but does not appear in the Web Serial port picker. The user concludes the flasher is broken.

**Why it happens:** Cheap USB cables, especially USB-C cables, are commonly power-only. Users bring whatever cable they have. At a conference, this is the #1 hardware issue.

**Prevention:**
- Add prominent "use a data cable" messaging with visual examples at the start of the wizard.
- When no ports appear in the Web Serial picker dialog, show a specific troubleshooting message: "No device detected? You may need a different USB cable. Data cables are available at [location]."
- At the event, have a supply of known-good USB data cables available for loan.
- Consider adding a "Cable Test" feature: if a port is selected but esptool.js cannot sync, suggest trying a different cable before suggesting other troubleshooting.

**Phase:** Phase 1 (connect step). UX messaging should guide users before they encounter the empty picker.

**Confidence:** HIGH -- this is universally reported across all ESP32 web flasher communities.

---

### Pitfall 7: Missing USB-to-Serial Drivers

**What goes wrong:** The ESP32 board uses a CH340, CH9102, or CP2102 USB-to-serial chip. The user's computer does not have the appropriate driver installed. The device does not appear in the port picker.

**Why it happens:** macOS and Linux ship with CP2102 drivers but may not have CH340/CH9102 drivers. Windows often needs manual driver installation for both. Newer CH340K variants require updated drivers that supersede older CH340 drivers.

**Prevention:**
- Document which USB-to-serial chips the supported devices use and link to driver downloads for each OS at the start of the wizard.
- Detect the OS (via `navigator.userAgent`) and show OS-specific driver instructions.
- Prefer recommending devices that use CP2102 (Silicon Labs) over CH340 (WCH) in the curated device whitelist, since CP2102 drivers are more commonly pre-installed.
- For ESP32-S3/C3/C6 boards with native USB (USB_SERIAL_JTAG): these do NOT need external drivers. Prioritize these in the recommended device list.

**Phase:** Phase 1 (browser/device check step). Pre-wizard compatibility check.

**Confidence:** HIGH -- [Meshtastic's own serial driver documentation](https://meshtastic.org/docs/getting-started/serial-drivers/esp32/) covers this extensively.

---

### Pitfall 8: Baud Rate Failures During Flash

**What goes wrong:** esptool.js attempts to flash at a high baud rate (921600 or 460800) and the connection drops partway through with a timeout error. The flash is partially written, leaving the device in a non-bootable state.

**Why it happens:** High baud rates are unreliable over long or low-quality USB cables, through USB hubs, or with certain USB-to-serial chips (especially CH340 clones). The initial connection always happens at 115200, but esptool.js upgrades to a higher speed for data transfer. If the upgrade fails silently, subsequent writes corrupt.

**Consequences:** Partial flash. Device does not boot. Requires full erase and reflash.

**Prevention:**
- Default to 460800 baud, not 921600. It is fast enough for Meshtastic firmware (~2MB) and much more reliable across diverse hardware.
- Implement retry logic: if the first flash attempt fails with a timeout, automatically retry at a lower baud rate (230400 or even 115200).
- Show flash progress percentage so users can see if it stalls (vs. no feedback where they might unplug the cable).
- After flash completes, verify with `flashMd5sum()` to confirm data integrity before declaring success.

**Detection:** Timeout errors during `writeFlash()`. Stalled progress percentage.

**Phase:** Phase 2 (flash step). Baud rate selection and retry logic are core flash configuration.

**Confidence:** HIGH -- baud rate issues are the most common esptool failure mode, documented across [esptool](https://docs.espressif.com/projects/esptool/en/latest/esp32/troubleshooting.html) and esptool-js issues.

---

### Pitfall 9: User Unplugs USB During Flash

**What goes wrong:** User disconnects the USB cable while flashing is in progress (impatient, accidental, or trying to "fix" a perceived hang). The firmware is partially written.

**Why it happens:** The flash process takes 30-90 seconds depending on baud rate and firmware size. Users do not realize it is still working, especially if progress feedback is inadequate.

**Consequences:** Partial flash. Device will not boot until a full erase + reflash. Not truly bricked (ROM bootloader is always intact), but the user thinks it is bricked.

**Prevention:**
- Show clear, animated progress with percentage and estimated time remaining. "Flashing firmware... 47% (about 30 seconds remaining)."
- Display a prominent warning: "Do NOT unplug your device during this step."
- Detect USB disconnect events (`navigator.serial` `disconnect` event) and show a clear recovery message: "Device disconnected during flash. Plug it back in and click 'Retry' to start over with a full erase."
- Always use full erase before flash (not incremental update) to ensure a clean state on retry.

**Phase:** Phase 2 (flash step). Progress UI and disconnect handling.

**Confidence:** HIGH -- universal flash tool concern, not Meshtastic-specific.

---

### Pitfall 10: HTTPS Requirement Blocks Local Development

**What goes wrong:** Developers run `npm run dev` on `localhost:3000` and Web Serial works fine. They deploy to a staging environment over HTTP (not HTTPS) and Web Serial stops working entirely. Or they try to test from a phone/other device on the local network via IP address and it fails.

**Why it happens:** Web Serial API requires a "secure context" -- either `localhost` (exempt) or HTTPS. This is a hard browser requirement with no workaround. Local network IP addresses (`192.168.x.x`) are not considered secure contexts.

**Consequences:** Development and testing friction. Features that work locally break in staging. Delays.

**Prevention:**
- Use `localhost` for all local development. Do not test via LAN IP.
- For staging/preview environments, always deploy behind HTTPS (CloudFront handles this for production).
- If testing from other devices on the network is needed, use `mkcert` to create locally-trusted certificates and serve Next.js with `--experimental-https` or a reverse proxy.
- Document this requirement prominently in the project README so contributors do not waste time debugging it.

**Phase:** Phase 0 (project setup). Address before any development begins.

**Confidence:** HIGH -- [MDN Web Serial API docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) and [Chrome developer docs](https://developer.chrome.com/docs/capabilities/serial) confirm secure context requirement.

---

### Pitfall 11: PSK and Credential Leakage in Client Bundle

**What goes wrong:** Channel PSK, MQTT credentials, or other secrets end up in the client-side JavaScript bundle. At DEF CON, attendees will inspect the bundle within minutes and extract these values.

**Why it happens:** Next.js makes it easy to accidentally expose server-side values to the client:
- Environment variables without the `NEXT_PUBLIC_` prefix are supposed to be server-only, but developers sometimes reference them in client components by mistake.
- Importing a shared config module that contains secrets into a client component pulls secrets into the bundle.
- The `/api/config` response is intentionally sent to the client, but caching or service worker behavior could persist it beyond the session.

**Consequences:** At a security conference, leaked credentials will be exploited immediately. Attackers could hijack the MQTT broker, impersonate users, or disrupt the mesh network.

**Prevention:**
- The `/api/config` endpoint returns secrets only to authenticated users -- this design is correct. Maintain it.
- Use Next.js Server Components for any code that touches secrets. Never import secret-containing modules in `"use client"` components.
- Add a build-time check: grep the client bundle for known secret patterns (PSK format, MQTT password patterns). Fail the build if found.
- Set `Cache-Control: no-store` on the `/api/config` response.
- Consider fetching config only at the moment it is needed (during the configure step), not on page load.
- Rotate PSK and MQTT broker credentials independently of the app deployment.

**Phase:** Phase 1 (API routes) and Phase 3 (configure step). Security review before any deployment.

**Confidence:** HIGH -- this is a known Next.js footgun, and DEF CON attendees will actively audit the app.

---

### Pitfall 12: ESP32-S3/C3/C6 USB_SERIAL_JTAG Boot Mode Trap

**What goes wrong:** After flashing an ESP32-S3, C3, or C6 device via its native USB_SERIAL_JTAG interface, the device reboots but stays in download mode instead of booting the application. It appears "stuck" and does not respond to `@meshtastic/core` connections.

**Why it happens:** The USB_SERIAL_JTAG peripheral can only trigger a core reset, which does not re-sample the boot strapping pins. After flashing, esptool.js sends a reset command, but the boot pin remains sampled as LOW (download mode) from the previous state.

**Consequences:** The configure step hangs waiting for a device that will never boot. User thinks the flash failed.

**Prevention:**
- Use the `--after watchdog-reset` equivalent in esptool.js when flashing via USB_SERIAL_JTAG. This triggers a full system reset that re-samples boot pins.
- Detect whether the connected device uses USB_SERIAL_JTAG (ESP32-S3, C3, C6 with native USB) vs. external UART (ESP32 with CP2102/CH340) and apply the appropriate reset strategy.
- If the device does not boot after reset, instruct the user to manually press the reset button on the device. Show this instruction prominently with a device image highlighting the reset button location.

**Detection:** Device does not enumerate as a serial port within 15 seconds of flash completion.

**Phase:** Phase 2 (flash step). Architecture-specific reset handling.

**Confidence:** HIGH -- documented in [Espressif's ESP32-S3 boot mode documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html) and [esptool-js issue #41](https://github.com/espressif/esptool-js/issues/41).

---

## Minor Pitfalls

Issues that are annoying but have straightforward fixes.

### Pitfall 13: Browser Tab Crash Leaves Serial Port Locked

**What goes wrong:** If the browser tab crashes or the user closes the tab while a serial port is open, the port may remain "locked" by Chrome. Reopening the page and trying to reconnect shows "port already in use" or fails silently.

**Prevention:**
- Register `beforeunload` and `unload` event handlers that attempt to release serial port locks gracefully.
- Show "close and reopen your browser if the port won't connect" as a troubleshooting step.
- The `forget()` method (Chrome 103+) can release port permissions, which sometimes clears stale locks.

**Phase:** Phase 2 (flash step). Cleanup handlers.

---

### Pitfall 14: Firmware ZIP Download/Extraction Corruption

**What goes wrong:** The vendored firmware ZIP in the Docker image is corrupted during build, or the in-browser ZIP extraction (if done client-side) produces corrupted binary data due to encoding issues.

**Prevention:**
- Vendor firmware at Docker build time, not at runtime. Extract the ZIPs during `docker build` and store the raw `.bin` files directly. No in-browser ZIP extraction needed.
- Add SHA256 checksum verification of firmware binaries in the Dockerfile.
- Serve `.bin` files as static assets from the Next.js public directory (or API route), not as ZIPs.

**Phase:** Phase 0 (project setup) and Phase 2 (flash step). Firmware vendoring is a build-time concern.

---

### Pitfall 15: Web Serial Port Picker Shows Too Many Ports

**What goes wrong:** Users see a long list of serial ports (Bluetooth serial, other USB devices, virtual ports) in the browser's `requestPort()` dialog and do not know which one to select. They pick wrong, and the flash fails with a confusing error.

**Prevention:**
- Use `requestPort()` with a filter for known USB vendor/product IDs (VID/PID) of supported ESP32 boards. Common VIDs: `0x10C4` (Silicon Labs CP2102), `0x1A86` (WCH CH340), `0x303A` (Espressif native USB).
- Show guidance text next to the port picker: "Select the device labeled 'CP2102' or 'CH340' or 'USB JTAG'."
- After selection, attempt a quick chip detect with esptool.js. If it fails, tell the user they may have selected the wrong port.

**Phase:** Phase 1 (connect step). Port filtering in `requestPort()` options.

---

### Pitfall 16: Event-Day Surge Overloads the Auth/Config API

**What goes wrong:** Hundreds of participants arrive at DEF CON and try to flash their devices simultaneously. Every flash session requires an authenticated call to `/api/config` to fetch MQTT credentials and channel PSK. The server is overwhelmed.

**Prevention:**
- The `/api/config` endpoint is lightweight (reads from DynamoDB, returns JSON). Standard ECS Fargate autoscaling should handle this.
- Pre-compute user configs and cache them (per-user, short TTL) to reduce DynamoDB reads.
- The actual flashing happens entirely client-side (Web Serial + esptool.js) with no server involvement. Only the config fetch hits the server. This is inherently scalable.
- Rate limit the `/api/config` endpoint per-user (1 request per 30 seconds) to prevent accidental hammering from retry loops.
- Consider pre-generating and caching configs for all registered users at event start.

**Phase:** Phase 3 (configure step) and deployment planning.

**Confidence:** MEDIUM -- the architecture (client-side flashing, server-side config only) inherently limits server load, but DynamoDB throttling under burst load is possible without proper provisioning.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Project setup (Phase 0) | HTTPS requirement blocks dev workflow (#10) | Use `localhost` only, document the constraint |
| Project setup (Phase 0) | Firmware vendoring corruption (#14) | Extract at build time, checksum verify, serve raw `.bin` files |
| Device picker (Phase 1) | Wrong firmware for device (#3) | Curated whitelist, build-time validation of device-to-binary mapping |
| Device picker (Phase 1) | Port picker confusion (#15) | VID/PID filters in `requestPort()` |
| Connect step (Phase 1) | Missing drivers (#7), power-only cable (#6) | OS detection with driver links, prominent cable guidance |
| Connect step (Phase 1) | Chrome version regression (#1) | Version check gate, pre-event testing against current Chrome |
| Flash step (Phase 2) | Wrong flash offsets (#5) | Use `.factory.bin` files, per-architecture offset map |
| Flash step (Phase 2) | Baud rate timeout (#8) | Default 460800, auto-retry at lower rate |
| Flash step (Phase 2) | User unplugs mid-flash (#9) | Progress UI, disconnect detection, full-erase retry |
| Flash step (Phase 2) | USB_SERIAL_JTAG boot trap (#12) | Watchdog reset for S3/C3/C6, manual reset button instruction |
| Flash-to-configure handoff | Port state corruption (#2) | Explicit stream release, timed delay, reconnect retry loop |
| Configure step (Phase 3) | Protobuf version mismatch (#4) | Pin @meshtastic/core to firmware version, config read-back verification |
| Configure step (Phase 3) | Credential leakage (#11) | Server components only, bundle audit, no-store cache headers |
| Event day | Auth/config surge (#16) | Config caching, inherently client-side architecture |
| Event day | Chrome update breaks everything (#1) | Pre-event Chrome version testing, CLI fallback plan |
| Event day | Mass cable/driver issues (#6, #7) | Loaner cables, driver install station, volunteers with CLI tools |

---

## Sources

### Official Documentation (HIGH confidence)
- [Espressif esptool Troubleshooting](https://docs.espressif.com/projects/esptool/en/latest/esp32/troubleshooting.html)
- [Espressif ESP32-S3 Boot Mode Selection](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html)
- [Chrome Web Serial API Developer Guide](https://developer.chrome.com/docs/capabilities/serial)
- [MDN Web Serial API Reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [ESP-IDF Partition Tables](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/partition-tables.html)
- [Meshtastic Serial Drivers](https://meshtastic.org/docs/getting-started/serial-drivers/esp32/)
- [Meshtastic CLI Flashing](https://meshtastic.org/docs/getting-started/flashing-firmware/esp32/cli-script/)
- [ESPLoader API Documentation](https://espressif.github.io/esptool-js/docs/classes/ESPLoader.html)

### GitHub Issues (MEDIUM-HIGH confidence)
- [esptool-js #206: Chrome 139 connection failure](https://github.com/espressif/esptool-js/issues/206)
- [esptool-js #227: Chrome 143 ESP32-S2 breakage](https://github.com/espressif/esptool-js/issues/227)
- [esptool-js #41: ESP32-C3 USB_SERIAL_JTAG timeout](https://github.com/espressif/esptool-js/issues/41)
- [esptool-js #233: Write failure mid-flash](https://github.com/espressif/esptool-js/issues/233)
- [esptool-js #234: Baud rate change triggers timeout](https://github.com/espressif/esptool-js/issues/234)
- [meshtastic/web-flasher#144: Port already open error](https://github.com/meshtastic/web-flasher/issues/144)
- [meshtastic/web-flasher#111: Factory.bin flash corruption](https://github.com/meshtastic/web-flasher/issues/111)
- [meshtastic/firmware#3338: Boot loop from wrong firmware](https://github.com/meshtastic/firmware/issues/3338)
- [meshtastic/firmware#4555: Power loss corrupts device config](https://github.com/meshtastic/firmware/issues/4555)
- [meshtastic/firmware#8543: Heltec V4 connection failure](https://github.com/meshtastic/firmware/issues/8543)

### Community/Ecosystem (MEDIUM confidence)
- [WICG Serial Port Locking Discussion](https://github.com/WICG/serial/issues/35)
- [Meshtastic Web Flasher Repository](https://github.com/meshtastic/web-flasher)
- [@meshtastic/core on npm](https://www.npmjs.com/package/@meshtastic/core)
- [Meshtastic Client API Documentation](https://meshtastic.org/docs/development/device/client-api/)
