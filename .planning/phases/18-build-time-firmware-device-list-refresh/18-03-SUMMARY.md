---
phase: 18
plan: 03
phase_name: Build-Time Firmware & Device List Refresh
plan_name: Dockerfile.webapp Rewrite — API Resolve, Factory Images, Grep Gate
date: 2026-07-01
status: code-complete-boot-test-pending
requirements_completed: [FLSH-06, FLSH-07, DEVC-06, DPLY-06]
requirements_pending: [FLSH-08]
---

# 18-03 Summary — Dockerfile.webapp Rewrite

Rewrote `apps/run.flash/webapp/Dockerfile.webapp` so a clean
`docker build` with no build-args resolves the current Meshtastic
stable release from api.meshtastic.org, vendors the correct
`*.factory.bin` for every ESP32 family, regenerates the ESP32-only
hardware list, threads `NEXT_PUBLIC_FIRMWARE_VERSION` into the Next.js
build, and enforces a post-build grep gate for the offline guarantee.

The remaining task (Task 3 — FLSH-08 hardware boot verification) is a
blocking human-verify checkpoint that requires physical hardware and
cannot be executed autonomously.

## Tasks completed

| # | Task | Commit |
|---|------|--------|
| 1 | Rewrite Stage 1 — API version resolve, `.factory.bin` extract, hardware-list regen | `3bca5000` |
| 2 | Stage 2 — `NEXT_PUBLIC_FIRMWARE_VERSION` plumbing, overwrite tracked hardware-list, post-build offline grep gate | `fb63c75f` |
| 3 | FLSH-08 hardware boot verification | **PENDING — human-verify checkpoint (see below)** |

## Files modified

- `apps/run.flash/webapp/Dockerfile.webapp` — Stage 1 rewritten; Stage 2 augmented; Stage 3 untouched.

## Invariants delivered

- Stage 1 installs `jq` alongside `curl` / `unzip` (needed for both API
  responses).
- Stage 1 resolves the version via
  `curl -fsSL https://api.meshtastic.org/github/firmware/list | jq -r '.releases.stable[0].id' | sed 's/^v//'`
  when `--build-arg FIRMWARE_VERSION` is empty; matches the dev-parity
  path in `scripts/download-firmware.sh` from 18-02.
- Build fails with a clear error naming the endpoint if the API is
  unreachable *and* no build-arg is provided — no hardcoded fallback,
  no `COPY src/config/firmware.ts` (that constant was removed in 18-01).
- Stage 1 unzips `firmware-*.factory.bin` (bootable at `0x00`, per
  FLSH-08 / Decision 1) instead of the app-only `.bin`. The
  `*-update.bin` sweep is retained as defense-in-depth.
- Resolved version is echoed on a dedicated
  `Resolved Meshtastic stable: ${FW_VER}` build-log line and persisted
  to `/firmware/VERSION.txt`.
- Stage 1 fetches `api.meshtastic.org/resource/deviceHardware`,
  jq-filters to `architecture ∈ {esp32, esp32-s3, esp32-c3, esp32-c6}`,
  and validates non-empty (`jq -e 'length > 0'`) — writes to
  `/hardware/hardware-list.json`.
- Stage 2 copies `/firmware/VERSION.txt` and
  `/hardware/hardware-list.json` out of the firmware stage; the
  regenerated list overwrites the tracked
  `public/data/hardware-list.json` snapshot before `next build` reads it.
- `npm run build` runs inside a single RUN that first exports
  `NEXT_PUBLIC_FIRMWARE_VERSION` from `/tmp/FIRMWARE_VERSION` and
  short-circuits (`test -n "$FW_VER"`) if the file is missing/empty —
  keeps Stage 1 the single source of truth without a duplicate ARG.
- Post-build grep gate (DPLY-06) fails the build if
  `api.meshtastic.org` or `github.com/meshtastic` appears anywhere in
  `.next/standalone` or `.next/static`; error names DPLY-06 for
  triage.
- Stage 3 (`runner`) is untouched — no runtime surface changes.

## Automated verification (both tasks green)

- Task 1: `api.meshtastic.org/github/firmware/list`,
  `api.meshtastic.org/resource/deviceHardware`, `.factory.bin`,
  `Resolved Meshtastic stable` all present; no `COPY src/config/firmware.ts`;
  no hardcoded `FW_VER=<digit>` — PASS.
- Task 2: `VERSION.txt`, `NEXT_PUBLIC_FIRMWARE_VERSION`,
  `public/data/hardware-list.json`, `grep -rE`, `DPLY-06` all present —
  PASS.

## Deviations from plan

None. Both code tasks executed as written. One deferred item:

- Task 3 (FLSH-08 hardware boot verification) is a
  `type="checkpoint:human-verify"` gate that requires plugging in a
  physical ESP32-family device, running the built container locally,
  and walking the flash pipeline end-to-end. This cannot be executed
  in a headless sandbox and is left for the operator per the plan's
  `autonomous: false` flag.

## Known issues / open risks

- **FLSH-08 open risk remains until boot test passes.** STATE.md
  already flags this as the highest v1.4 risk. The Dockerfile changes
  above are the *precondition* for the boot test but not the
  verification itself — the factory image switch is the whole reason
  Task 3 exists.

## Task 3 — human-verify checkpoint (blocking)

**What was built (ready for verification):** A container image that,
when built from this Dockerfile without build-args, vendors the
`*.factory.bin` for each ESP32 family and serves it through the
flasher UI. The flash pipeline (`writeFlash({ address: 0x0 })` +
`flashMd5sum(0x0, size)` in `src/hooks/use-flash.ts`) does not need
to change — factory images are meant for offset `0x00`.

**How to verify (operator, in order):**

1. Build locally:
   ```
   docker build -t run-flash-p18 -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/
   ```
   Confirm the log contains a `Resolved Meshtastic stable: X.Y.Z.hash`
   line and an `Extracted N firmware binaries` line with N ≥ 1.
2. Run: `docker run --rm -p 3000:3000 run-flash-p18`
3. Open http://localhost:3000/ in Chrome or Edge (Web Serial required).
4. Plug in ONE device from the Recommended set:
   `HELTEC_V3`, `TBEAM`, `TLORA_V2_1_1P6`, `RAK4631`, or `STATION_G2`.
5. Walk Pick Device → Connect → Flash → Configure → Done.
6. Unplug and replug; confirm the device boots (LED/display shows
   Meshtastic boot sequence, no bootloop) and connects (Meshtastic
   Web/mobile UI sees the node, or the flasher's post-flash configure
   step succeeds).
7. Record `{device_slug}` and `{resolved_firmware_version}` here.

**Resume signal (per plan):**
`approved: {device_slug} at {version}` — proceed to close Phase 18.
`failed: {reason}` — revert Decision 1 (factory image) and revisit
FLSH-08 before closing Phase 18.

## Next

- **Operator:** run the boot test above. On success, this SUMMARY gets
  the tested device slug + resolved version appended and FLSH-08 marked
  complete; on failure, open a 18-04 hotfix plan reverting the
  `.factory.bin` switch and investigating the app-only vs factory-image
  boot behavior against `use-flash.ts` offsets.
- **After boot test green:** Phase 18 is complete; ready for
  `/gsd:plan-phase 19` (branding, dependency bumps, connect/error UX).
