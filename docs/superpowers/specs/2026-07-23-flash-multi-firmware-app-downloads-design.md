# run.flash: Multi-Firmware Versions, rp2040 Support, and App Downloads

**Date:** 2026-07-23
**Status:** Approved (design reviewed by Kurt in session)
**App:** apps/run.flash

## Goal

Let flashers choose between three firmware versions (default = current 2.7 stable),
close the rp2040 device-coverage gap, and offer phone-app downloads (two Android
APKs + iOS App Store link) — all self-hosted, preserving the offline guarantee
(DPLY-06), and delivered via the standard release-all.sh → deploy.yml flow.

## Background / verified upstream facts (2026-07-23)

- Meshtastic **firmware** has no 2.8 release line yet. Stable = `2.7.26.54e0d8d`,
  previous stable = `2.7.15.567b8ea`. The "2.8" users see in the official flasher
  is the **develop nightly**, published to a single rolling folder:
  `https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/firmware-nightly/`
  with an `index.json` (`{id, version, title}`; currently `v2.8.0.ef1aedd`) and flat
  per-board files using the same `firmware-{platformioTarget}-{version}.factory.bin`
  / `.uf2` naming the app already consumes.
- The "2.8 that shipped" is the **Android app** `v2.8.0-open.1` (2026-07-23), whose
  GitHub release carries direct APK assets (`androidApp-fdroid-universal-release.apk`).
- Android app **2.7.14 has a known BLE-connect regression** (upstream issue #4869);
  **2.7.13** is the last known-good of the old line. Its release tag is `v2.7.13`
  with older asset naming: `app-fdroid-release.apk` (universal).
- `firmware-rp2040-{ver}.zip` exists for both pinned firmware versions (verified 200).
- Upstream device architectures: esp32 (19), esp32-s3 (40), esp32-c3 (1),
  esp32-c6 (2), nrf52840 (31) — all supported today — plus **rp2040 (4)**
  (RAK 11310, RP2040 LoRa, Raspberry Pi Pico) and portduino (2, Linux-native,
  not browser-flashable, out of scope).

## Design

### 1. Firmware version manifest (build side)

New checked-in file `apps/run.flash/webapp/firmware-versions.json`:

```json
{
  "versions": [
    { "slot": "stable",   "pin": "2.7.26.54e0d8d", "label": "2.7.26 — recommended", "default": true },
    { "slot": "previous", "pin": "2.7.15.567b8ea", "label": "2.7.15 — previous stable" },
    { "slot": "nightly",  "pin": "",                "label": "2.8.0 nightly — experimental" }
  ]
}
```

Dockerfile Stage 1 loops over the slots:

- **Pinned slots** download release arch zips exactly as today, arch list now
  `esp32 esp32s3 esp32c3 esp32c6 nrf52840 rp2040`; extract `*.factory.bin` + `*.uf2`.
- **Nightly slot** (empty pin) resolves `firmware-nightly/index.json` at build time,
  then fetches `firmware-{target}-{id}.factory.bin` (esp32 families) and `.uf2`
  (nrf52840/rp2040) per target derived from the hardware list. New fetcher is
  ~30 lines; it downloads individual files (the nightly folder is flat, not zipped).
- Stage 1 writes resolved metadata to `public/data/firmware-manifest.json`:
  `{ versions: [{ version, label, default, slot }] }`. The client fetches this at
  runtime — same pattern as `hardware-list.json`.
- `NEXT_PUBLIC_FIRMWARE_VERSION` is kept and set to the **default slot's resolved
  version**, so all existing code paths (Done screen, next.config.ts assertion,
  config pipeline) are unchanged unless the user picks a non-default version.
- Local dev parity: `scripts/download-firmware.sh` gains the same loop + manifest
  write; `scripts/generate-hardware-list.sh` filter synced with the Dockerfile
  (it currently lacks nrf52840 — drift fixed as part of this work).

**Accepted caveats:**
- The nightly is **frozen at build time** — it advances only when run.flash is
  re-released. Deliberate: a frozen, self-hosted artifact during con.
- A nightly bin missing for a fringe target is a build **warning**, not a failure.
  The Flash step's existing 404 error message covers it at runtime. Pinned slots
  keep today's behavior (whole-arch zips; missing zip = warn + continue).
- A nightly cannot be re-pinned after upstream rotates the folder (it holds only
  the current build). The manifest records what was baked.
- Firmware payload roughly triples (~1GB in image + S3): image-size/build-time
  tax only; build.sh S3 sync of `public/` is generic and needs no change.

### 2. Version picker (Flash step UI)

- HeroUI `Select` on the Flash step, above the flash button, populated from
  `firmware-manifest.json`, default preselected, "experimental" chip styling for
  the nightly entry.
- Selected version threads into the existing `loadFirmware(device, version)` /
  `loadUf2(device, version)` (both already accept a version parameter).
- Done step displays the version that was actually flashed.
- Wizard flow, steps, and ?step= jump logic are unchanged.

**Risk (flagged, accepted):** the Configure/verify pipeline has never run against
2.8 develop firmware; protobuf drift is possible. Existing guards behave sanely
(hard-fail only on positively-read mismatch; fail-open on timeout). A real-radio
bench test of the nightly path (Kurt) is part of acceptance.

### 3. rp2040 support

- Add `rp2040` to: Dockerfile arch loop, Dockerfile hardware-list jq filter,
  both local scripts, and the device-family mapping (`getDeviceFamily`).
- rp2040 maps to the existing nRF52 UF2 flow (both are UF2 mass-storage
  bootloaders). Only the "enter bootloader" instruction text differs:
  hold BOOTSEL while plugging in (rp2040) vs double-tap reset (nRF52).
- Result: full coverage of browser-flashable Meshtastic hardware (97/99;
  portduino excluded by nature).

### 4. App downloads (Done step + landing)

- Dockerfile Stage 1 downloads two pinned APKs into `public/apps/`:
  - `https://github.com/meshtastic/Meshtastic-Android/releases/download/v2.7.13/app-fdroid-release.apk`
    → label "Android 2.7.13 — most reliable (BLE)"
  - `https://github.com/meshtastic/Meshtastic-Android/releases/download/2.8.0-open.1/androidApp-fdroid-universal-release.apk`
    → label "Android 2.8.0 — newest (beta)"
  (exact tag forms verified during implementation; download failure = build failure,
  these are load-bearing)
- Served from S3/CloudFront like firmware. GitHub URLs exist **only at build
  time**; the runtime app-links metadata lives in a dedicated
  `public/data/apps-manifest.json` carrying local filenames + labels + sizes
  only, so the DPLY-06 grep gate stays fully intact.
- iOS: static App Store link (Meshtastic on the App Store) — no mirroring possible.
- New `AppDownloadsCard` component: full variant on the Done step ("now pair your
  phone"), compact variant on the landing/pick-device screen. Includes a one-line
  Android sideload note (allow installs from unknown sources).

### 5. Testing

- Vitest: manifest parsing/validation, nightly-fetcher filename construction,
  version threading in firmware.ts helpers, device-family mapping for rp2040.
  (Node ≥22.12 for vitest per repo convention.)
- Build-time gates: existing DPLY-06 grep gate unchanged; manifest JSON validated
  non-empty in Stage 1 (same jq -e pattern as hardware-list).
- Post-deploy verification: live version curl, fetch `firmware-manifest.json`,
  HEAD one factory.bin per version slot, HEAD both APKs.
- Human acceptance: Kurt flashes a real radio on the default path (regression)
  and once on the nightly path (new).

### 6. Delivery

- Branch `feat/flash-multi-firmware-app-downloads` (this worktree), feature PR
  for review, then standard release: copy `env.local.sh` into the worktree root
  first (known landmine), `./apps/release-all.sh --apps run.flash --pr`, deploy
  via `deploy.yml` GitHub Actions, live verification as above.

## Out of scope

- Auto-tracking upstream nightly without a re-release.
- portduino / Linux-native targets.
- Any change to the Configure step's MQTT/identity logic.
- Play Store / F-Droid store listings (direct APK + App Store link only).
