# Requirements: v1.4 Flash Service Refresh

**Milestone Goal:** `run.flash` flashes the latest *stable* Meshtastic firmware — resolved automatically at build time and presented as the DCR34 "run.defcon.run firmware" — with a refreshed ESP32-only device list, bumped dependencies, and a DCR34 branding/UX pass.

**App:** `apps/run.flash/webapp` (Next.js 16 / React 19 / HeroUI). Deployed multi-region (use1/cac1) with firmware assets vendored into the Docker image.

**Anchor decision:** Latest-stable is resolved at **build time** (not runtime), preserving v1.0's zero-runtime-dependency guarantee. No firmware version picker — one auto-tracked stable build.

---

## Requirements

### Firmware Versioning (FLSH)

- [ ] **FLSH-06**: The Docker build resolves the latest **stable** Meshtastic release tag from `api.meshtastic.org/github/firmware/list` (`releases.stable[0]`) instead of a hardcoded version, and vendors that release's binaries.
- [ ] **FLSH-07**: `FIRMWARE_VERSION` is a build-injected single source of truth (no manual placeholder in `src/config/firmware.ts`); the resolved version is surfaced in the flasher UI.
- [ ] **FLSH-08**: The flasher vendors and writes the correct **factory** image at offset `0x00` with full erase → write → MD5 verify. Confirm current behavior (which keeps `firmware-{target}-{version}.bin` and writes at `0x00`) flashes a bootable device; switch to `*.factory.bin` if it does not.

### Device List (DEVC)

- [ ] **DEVC-06**: `public/data/hardware-list.json` is regenerated at build time from `api.meshtastic.org/resource/deviceHardware`, filtered to ESP32-family (`esp32`, `esp32-s3`, `esp32-c3`, `esp32-c6`), with the DCR34 Recommended set preserved and sorted first.

### Deployment (DPLY)

- [ ] **DPLY-06**: Latest-stable resolution and hardware-list regeneration happen at **build time** only; the running container has zero external runtime dependency on GitHub or `api.meshtastic.org` (offline-at-event guarantee preserved). A clean image build with no code edits produces a flasher on the current stable firmware.

### Dependencies (DEPS)

- [ ] **DEPS-01**: Bump `@meshtastic/core`, `@meshtastic/transport-web-serial`, and `esptool-js` to their latest compatible versions; carry over the `tlora-t3s3 → flashMode 'dio'` quirk; the full pick → connect → flash → configure → done flow works with no regression.

### Branding & UX (BRND)

- [ ] **BRND-01**: The UI presents the firmware as the DCR34 **"run.defcon.run firmware"** (with the underlying Meshtastic version shown as a subtitle, e.g. "run.defcon.run firmware · Meshtastic {version}"), replacing generic Meshtastic version strings.
- [ ] **BRND-02**: Connect, bootloader-help, and error-state UX are aligned with the current flasher.meshtastic.org patterns (clear bootloader/DFU guidance, chip-mismatch messaging, actionable serial-error copy).

---

## Future Requirements (deferred)

- Runtime firmware refresh / "check for newer stable" while online — deferred; build-time vendoring is the chosen model for the event.
- nRF52 / RP2040 (UF2/DFU) device support — out of ESP32-only scope.

---

## Out of Scope

- **Firmware version picker UI** — one auto-tracked stable build; version choice confuses novice users (carried from v1.0).
- **Custom / event-hosted firmware builds** — stock Meshtastic stable only; no `event/{pathPrefix}` hosting of our own binaries.
- **Runtime dependency on api.meshtastic.org / GitHub** — resolution is build-time only.
- **Firefox / Safari support** — Web Serial is Chrome/Edge only.
- **BLE flashing** — USB Web Serial only for initial provisioning.

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FLSH-06 | Phase 18 | Pending |
| FLSH-07 | Phase 18 | Pending |
| FLSH-08 | Phase 18 | Pending |
| DEVC-06 | Phase 18 | Pending |
| DPLY-06 | Phase 18 | Pending |
| DEPS-01 | Phase 19 | Pending |
| BRND-01 | Phase 19 | Pending |
| BRND-02 | Phase 19 | Pending |

*(Phase column filled in by the roadmapper.)*
