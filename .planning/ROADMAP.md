# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [x] **v1.1 CMS Content Types** - Phases 5-9 (shipped 2026-03-05)
- [x] **v1.2 User Checkins** - Phases 10-13 (shipped 2026-03-06)
- [x] **v1.3 Meshtk Integration** - Phases 14-17 (shipped 2026-07-01)
- [ ] **v1.4 Flash Service Refresh** - Phases 18-19 (in progress)

## Phases

<details>
<summary>v1.0 Meshtastic Flasher MVP (Phases 1-4) - SHIPPED 2026-03-02</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for archived v1.0 roadmap.

</details>

<details>
<summary>v1.1 CMS Content Types (Phases 5-9) - SHIPPED 2026-03-05</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for archived v1.1 roadmap.

</details>

<details>
<summary>v1.2 User Checkins (Phases 10-13) - SHIPPED 2026-03-06</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for archived v1.2 roadmap.

- [x] Phase 10: CheckIn Data Layer (1/1 plans) — completed 2026-03-06
- [x] Phase 11: Check-in API Routes (1/1 plans) — completed 2026-03-06
- [x] Phase 12: CheckInModal + Header Integration (1/1 plans) — completed 2026-03-06
- [x] Phase 13: Profile Check-in Display (1/1 plans) — completed 2026-03-06

</details>

<details>
<summary>v1.3 Meshtk Integration (Phases 14-17) - SHIPPED 2026-07-01</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for archived v1.3 roadmap.

- [x] Phase 14: Infrastructure Foundation (3/3 plans) — completed 2026-03-07
- [x] Phase 15: Container Images + Task Definition (3/3 plans) — completed 2026-03-07
- [x] Phase 16: Build/Deploy Pipeline (2/2 plans) — completed 2026-03-07
- [x] Phase 17: Meshmap Verification + Branding (1/1 plans) — completed 2026-03-07

> Phase 18 (Fleet Simulator + Easter Egg) deferred to `.planning/backlog/fleet-simulator-easter-egg.md`.

</details>

### v1.4 Flash Service Refresh (Phases 18-19) - ACTIVE

- [ ] **Phase 18: Build-Time Firmware & Device List Refresh** - Auto-resolve latest stable, vendor the correct bootable factory image, regenerate the ESP32-only device list — all at build time
- [ ] **Phase 19: Dependencies & DCR34 Branding/UX** - Bump Meshtastic/esptool deps with no regression and ship the "run.defcon.run firmware" identity with connect/bootloader/error UX alignment

## Phase Details

### Phase 18: Build-Time Firmware & Device List Refresh
**Goal**: A clean image build automatically vendors the correct, bootable latest-stable Meshtastic firmware and a refreshed ESP32-only device list, with zero external runtime dependency.
**Depends on**: Nothing (first phase of v1.4)
**Requirements**: FLSH-06, FLSH-07, FLSH-08, DEVC-06, DPLY-06
**Success Criteria** (what must be TRUE):
  1. Flashing an ESP32 device writes the vendored **factory** image at offset `0x00` (erase → write → MD5 verify) and produces a device that boots and connects — the highest-risk item, confirmed before the version-resolution change is relied upon.
  2. A clean `docker build` with no code edits produces a flasher pinned to the **current** Meshtastic stable release, resolved from `api.meshtastic.org/github/firmware/list` (`releases.stable[0]`) — no hardcoded version remains anywhere.
  3. `FIRMWARE_VERSION` is build-injected as the single source of truth (no manual placeholder in `src/config/firmware.ts`) and the resolved version is visible in the flasher.
  4. The device picker shows an ESP32-only hardware list regenerated at build from `api.meshtastic.org/resource/deviceHardware` (esp32/esp32-s3/esp32-c3/esp32-c6), with the DCR34 Recommended set preserved and sorted first.
  5. The running container makes no network calls to GitHub or `api.meshtastic.org` (offline-at-event guarantee verified).
**Plans**: TBD

### Phase 19: Dependencies & DCR34 Branding/UX
**Goal**: The flasher runs on bumped Meshtastic/esptool dependencies with no regression, and presents a cohesive DCR34 "run.defcon.run firmware" identity with connect, bootloader-help, and error UX aligned to current flasher.meshtastic.org patterns.
**Depends on**: Phase 18 (branding surfaces the build-injected version and Recommended device list; the dependency bump must be validated against the refreshed firmware/factory-image flash path)
**Requirements**: DEPS-01, BRND-01, BRND-02
**Success Criteria** (what must be TRUE):
  1. `@meshtastic/core`, `@meshtastic/transport-web-serial`, and `esptool-js` are bumped to their latest compatible versions and the full pick → connect → flash → configure → done flow completes with no regression.
  2. The `tlora-t3s3 → flashMode 'dio'` quirk is preserved and that board still flashes successfully.
  3. The UI presents the firmware as **"run.defcon.run firmware"** with the underlying Meshtastic version shown as a subtitle (e.g. "run.defcon.run firmware · Meshtastic {version}"), replacing generic Meshtastic version strings.
  4. Connect, bootloader-help, and error states give clear DFU/bootloader guidance, chip-mismatch messaging, and actionable serial-error copy aligned with flasher.meshtastic.org.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 14. Infrastructure Foundation | v1.3 | 3/3 | Complete | 2026-03-07 |
| 15. Container Images + Task Definition | v1.3 | 3/3 | Complete | 2026-03-07 |
| 16. Build/Deploy Pipeline | v1.3 | 2/2 | Complete | 2026-03-07 |
| 17. Meshmap Verification + Branding | v1.3 | 1/1 | Complete | 2026-03-07 |
| 18. Build-Time Firmware & Device List Refresh | v1.4 | 0/0 | Not started | - |
| 19. Dependencies & DCR34 Branding/UX | v1.4 | 0/0 | Not started | - |
