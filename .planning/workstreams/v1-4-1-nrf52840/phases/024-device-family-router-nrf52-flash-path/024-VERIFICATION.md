---
phase: 024-device-family-router-nrf52-flash-path
verified: 2026-07-02T00:00:00Z
status: human_needed
score: 5/5 code-side must-haves verified (3 items require human verification — 2 docker build gates + 1 hardware-in-loop)
overrides_applied: 0
plans_verified:
  - 024-01-PLAN.md
  - 024-02-PLAN.md
requirements_covered:
  - DEVC-07
  - FLSH-09
  - DPLY-07
  - DPLY-06
human_verification:
  - test: "docker build --no-cache -f apps/run.flash/webapp/Dockerfile.webapp against Meshtastic stable — confirm Stage 1 log line reports Extracted N firmware binaries including .uf2 files"
    expected: "docker build succeeds; Stage 1 log shows nrf52840 zip downloaded and .uf2 files extracted"
    why_human: "No docker daemon in sandbox (`command -v docker` absent, `/var/run/docker.sock` missing). Requires network + docker daemon on a build host."
  - test: "docker run --rm dc34-run-flash-app sh -c 'grep -q _T1000_E /app/public/data/hardware-list.json && ls /app/public/firmware/ | grep -qE \"\\.uf2$\"'"
    expected: "Built image contains a T-1000E family slug in hardware-list.json AND at least one firmware-*.uf2 in /app/public/firmware/"
    why_human: "Docker build required (see above). Note: SUMMARY.md references slug 'SEEED_TRACKER_T1000_E' but committed hardware-list.json snapshot uses 'TRACKER_T1000_E' — reviewer should confirm which slug the current Meshtastic stable release ships and update the TODO comment in src/config/devices.ts if needed."
  - test: "T-1000E in bootloader mode (double-tap RST) → Web USB DFU picker offers device → openDfu succeeds → dfuWrite streams .uf2 → dfuVerify reports OK → device auto-resets into Meshtastic app → device enumerates as Serial CDC and Meshtastic client can talk to it"
    expected: "Console shows: === Stage 1/2: Writing firmware over DFU ===, writePercent climbs 0→100, === Stage 2/2: Verifying DFU status ===, DFU status OK — device is in dfuIDLE, === Flash complete! ==="
    why_human: "Phase 24 SC4 hardware-in-loop. Sandbox has no USB, no Web USB browser, no T-1000E hardware. Per Kurt's directive, hardware SCs must be surfaced under Human Verification Required — NOT falsely scored green. Belongs to Phase 25 SC4 hardware pass."
  - test: "Failure-mode spot-check on Web USB DFU: (a) cancel picker → disconnected, no toast (b) unplug during flash → 'USB connection lost' toast (c) missing .uf2 → 'UF2 firmware not found for {displayName}' toast"
    expected: "Each failure mode produces the mapped getDfuErrorMessage output"
    why_human: "Requires physical unplug during a live flash + a curated failure fixture — sandbox cannot exercise Web USB error paths."
  - test: "Positive-control ESP32 regression on the Phase 19 Recommended set (any of HELTEC_V3 / TBEAM / TLORA_V2_1_1P6 / RAK4631 / STATION_G2) — end-to-end erase → write → verify still runs verbatim with no copy or UX regression"
    expected: "Recommended ESP32 flash completes as it did on v1.4 shipped; no new console output, no changed timing, no error paths that were previously silent"
    why_human: "Hardware SC4 companion — ESP32 zero-regression is enforced by construction at code review (git diff --stat use-flash-esp32.ts / use-serial.ts / lib/esptool.ts returns 0 lines since bd8c828f) but user-observable regression against real hardware still needs a physical positive-control run."
---

# Phase 24: Device-family router + nRF52 flash path — Verification Report

**Phase Goal:** `apps/run.flash/webapp` flashes an nRF52840 device (Seeed T1000-E) end-to-end via UF2/Web-USB-DFU alongside the existing ESP32 esptool-js path — with a single device-family router that routes by `deviceHardware.architecture`.

**Verified:** 2026-07-02
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Phase 24 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dockerfile.webapp Stage 1 jq filter admits `nrf52840` alongside `esp32*` architectures; hardware-list contains the T-1000E slug + Recommended set is preserved | VERIFIED (code) + human-check (build artifact) | Dockerfile.webapp line 39: `[.[] | select(.architecture == "esp32" or .architecture == "esp32-s3" or .architecture == "esp32-c3" or .architecture == "esp32-c6" or .architecture == "nrf52840")]` — jq filter present. `src/config/devices.ts` RECOMMENDED_SLUGS unchanged: 5 ESP32 slugs (HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, STATION_G2) — grep -c returns 5. Committed hardware-list.json snapshot contains 28 nrf52840 devices (informational — the snapshot is regenerated at Docker build). Runtime hardware-list contents from the actual `docker build` deferred to human verification. |
| 2 | Dockerfile.webapp Stage 1 extracts `firmware-t1000-e-{version}.uf2` alongside ESP32 `.factory.bin` set; both artifact families ship in same image; DPLY-06 grep gate still passes | VERIFIED (code + gate) + human-check (build artifact) | Dockerfile.webapp line 23: `for ARCH in esp32 esp32s3 esp32c3 esp32c6 nrf52840` — nrf52840 in loop. Line 28: `unzip -q -o "/tmp/${ZIP}" "firmware-*.uf2" -d /firmware/` — parallel `.uf2` extract present. Line 96-98 DPLY-06 grep gate untouched. **Local `next build` + DPLY-06 grep against `.next/standalone` + `.next/static`: 0 hits for `api.meshtastic.org` / `github.com/meshtastic` (PASS)**. Actual `.uf2` presence in built image deferred to human verification (docker build). |
| 3 | use-flash.ts has family discriminator on `deviceHardware.architecture` — ESP32 family → existing esptool-js path (unchanged); nrf52840 → new UF2/DFU write path | VERIFIED | `src/types/device.ts:24` — `NRF52_ARCHITECTURES = ["nrf52840"] as const`. Lines 45-49 — `getDeviceFamily(device)` returns `"esp32"` / `"nrf52"` and throws on unknown. `src/hooks/use-flash.ts:6` imports `getDeviceFamily`, lines 58-59 unconditionally call both delegates, lines 73-78 dispatch on family. `src/hooks/use-flash-esp32.ts` — byte-identical extract (see SC4 evidence). `src/hooks/use-flash-nrf52.ts` — real DFU pipeline (see SC4 evidence). |
| 4 | UF2/DFU path successfully writes `.uf2` to T-1000E in bootloader mode and reports completion; ESP32 path has zero regression against Phase 19 Recommended set | SPLIT: code-side VERIFIED, hardware-in-loop HUMAN VERIFICATION | **ESP32 zero-regression:** `git diff bd8c828f..HEAD -- src/hooks/use-flash-esp32.ts src/hooks/use-serial.ts src/lib/esptool.ts` returns 0 lines — verbatim since Plan 24-01 extract. `git log --oneline -- src/hooks/use-flash-esp32.ts` shows single commit `bd8c828f` (verbatim extract, never modified). **nRF52 code-side:** `use-flash-nrf52.ts` (181 LOC) no longer contains "nRF52 flash not yet implemented" (`grep -rn` returns 0 hits). Pipeline calls `loadUf2(device)` → `dfuWrite(dfuDevice, firmware.data, reportProgress)` → `dfuVerify(dfuDevice)` with logs `=== Stage 1/2 ===` and `=== Stage 2/2 ===`. Router narrows `transport: ESPLoader \| DfuDevice` (line 35). **Hardware write actually reaching a T-1000E in bootloader mode → HUMAN VERIFICATION per Kurt's directive.** |
| 5 | `next build` + `tsc --noEmit` clean; no runtime calls to `api.meshtastic.org` or `github.com/meshtastic` under new path | VERIFIED | `npx tsc --noEmit` in `apps/run.flash/webapp/`: clean (exit 0, no output — verified in this sandbox). `NEXT_PUBLIC_FIRMWARE_VERSION=0.0.0 npx next build` succeeded: `Compiled successfully in 11.9s`, 7 static pages, 4 dynamic routes. Post-build `grep -rE 'api\.meshtastic\.org\|github\.com/meshtastic' .next/standalone .next/static`: 0 hits (verified in this sandbox). |

**Score:** 5/5 code-side must-haves verified. 3 human-verification items remain (2 docker-build gates + 1 hardware-in-loop DFU write; plus companion ESP32 positive-control run).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/device.ts` | NRF52_ARCHITECTURES + getDeviceFamily + isNrf52Device + DeviceFamily | VERIFIED | 56 LOC. Contains `NRF52_ARCHITECTURES = ["nrf52840"] as const`, `isNrf52Device`, `DeviceFamily = "esp32" \| "nrf52"`, `getDeviceFamily` (throws on unknown). |
| `src/hooks/use-flash-esp32.ts` | Verbatim extract of prior useFlash body, min_lines 180 | VERIFIED (WIRED) | 216 LOC. Contains full 3-stage pipeline (erase → write → verify), the `tlora-t3s3 → "dio"` quirk at lines 104-106, `beforeunload` effect, `INITIAL_FLASH_PROGRESS` state. Zero-diff since `bd8c828f` (Plan 24-01 extract). Imported by `use-flash.ts:9`. |
| `src/hooks/use-flash-nrf52.ts` | 2-stage write→verify pipeline, min_lines 100 | VERIFIED (WIRED) | 181 LOC. Contains `loadUf2` import, `dfuWrite` + `dfuVerify` calls, `eraseComplete: true` seeded in `NRF52_INITIAL_PROGRESS`. Stub error "nRF52 flash not yet implemented" absent from source tree. Imported by `use-flash.ts:10`. |
| `src/hooks/use-flash.ts` | Family-aware router hook | VERIFIED (WIRED) | 98 LOC. Imports `getDeviceFamily`, `useFlashEsp32`, `useFlashNrf52`, `DfuDevice`. Both delegates called unconditionally at top level (React rules-of-hooks). Dispatch by `getDeviceFamily(device)` at lines 73-78. Transport type narrowed to `ESPLoader \| DfuDevice` (line 35). |
| `src/lib/web-dfu.ts` | DFU 1.1 host: openDfu / dfuWrite / dfuVerify / closeDfu / getDfuErrorMessage, min_lines 150 | VERIFIED (WIRED) | 389 LOC. Top-of-file audit block records library shootout (all 3 shortlist candidates E404, fell back to custom per CONTEXT D-02). Implements DFU 1.1 state machine (DFU_DNLOAD + DFU_GETSTATUS + DFU_CLRSTATUS). transferSize 4096, interface class 0xFE / subclass 0x01. Imported by `use-flash-nrf52.ts` + `use-dfu.ts`. |
| `src/hooks/use-dfu.ts` | Web USB DFU connection state hook, min_lines 100 | VERIFIED (WIRED) | 165 LOC. Mirrors `use-serial.ts` structure. Calls `navigator.usb.requestDevice({ filters: [{ classCode: 0xfe, subclassCode: 0x01 }] })` inside `connect()`. Handles NotAllowedError silently (user cancelled picker). Unmount cleanup effect calls `closeDfu`. |
| `src/config/firmware.ts` | getUf2Filename + loadUf2 helpers | VERIFIED (WIRED) | 123 LOC. `getUf2Filename(device, version)` returns `firmware-${platformioTarget}-${version}.uf2`. `loadUf2(device)` fetches from `${FIRMWARE_BASE_PATH}/${filename}`, returns `{ data: Uint8Array; size: number; filename: string }`. Imported by `use-flash-nrf52.ts:6`. |
| `Dockerfile.webapp` | Stage 1 extended for nrf52840 arch + .uf2 extract + hardware-list filter | VERIFIED (code) + human-check (build) | Line 23 adds `nrf52840` to `for ARCH in ...`. Line 28 parallel `unzip firmware-*.uf2` step. Line 39 jq filter admits `or .architecture == "nrf52840"`. Line 32 log line counts `.factory.bin` + `.uf2`. Line 96-98 DPLY-06 offline-gate untouched. Actual `docker build` run deferred to human verification. |
| `src/config/devices.ts` | RECOMMENDED_SLUGS unchanged + TODO comment | VERIFIED | Line 23: `// TODO(v1.4.1 close-out): promote T-1000E (hwModelSlug SEEED_TRACKER_T1000_E) after Phase 25 SC4 hardware verify.` (Note: reviewer should confirm actual upstream slug — see human_verification item 2.) Lines 24-30 contain exactly 5 ESP32 slugs. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `use-flash.ts` | `types/device.ts` | `getDeviceFamily(device)` dispatch | WIRED | Import at line 6, called at line 73 inside `flash` callback. |
| `use-flash.ts` | `use-flash-esp32.ts` | `useFlashEsp32()` delegate call | WIRED | Import line 9, called at line 58, dispatched at line 76 (`esp32.flash(transport as ESPLoader, device, appendLog)`). |
| `use-flash.ts` | `use-flash-nrf52.ts` | `useFlashNrf52()` delegate call | WIRED | Import line 10, called at line 59, dispatched at line 78 (`nrf52.flash(transport as DfuDevice, device, appendLog)`). |
| `use-flash-nrf52.ts` | `lib/web-dfu.ts` | `dfuWrite` + `dfuVerify` calls | WIRED | Import line 9. `dfuWrite` called at line 94 with `(dfuDevice, firmware.data, reportProgress)`. `dfuVerify` called at line 120 with `(dfuDevice)`. |
| `use-flash-nrf52.ts` | `config/firmware.ts` | `loadUf2(device) → Uint8Array → DFU write` | WIRED | Import line 6 (`loadUf2, formatBytes`). Called at line 77: `const firmware = await loadUf2(device)`. Passed to `dfuWrite` at line 94 as `firmware.data`. |
| `use-dfu.ts` | `lib/web-dfu.ts` | `openDfu` / `closeDfu` / `getDfuErrorMessage` lifecycle | WIRED | Import line 6. `openDfu(usbDevice)` at line 111. `closeDfu(current)` at line 78 + line 146 (unmount cleanup). `getDfuErrorMessage(err)` at line 123. |
| `use-dfu.ts` | Web USB API | `navigator.usb.requestDevice({ filters: [{ classCode: 0xfe, subclassCode: 0x01 }] })` | WIRED | Line 100-102. Called inside `connect()` (user-gesture-scoped). NotAllowedError handled silently at line 118-121. |
| `Dockerfile.webapp` Stage 1 | `public/data/hardware-list.json` (Stage 2) | jq filter admits nrf52840 → hardware-list contains T-1000E slug | WIRED (code) + human-check (build) | jq filter at line 39 syntactically correct (dry-run verified in SUMMARY 024-01). Actual regeneration requires `docker build` (deferred). |
| `Dockerfile.webapp` Stage 1 firmware/ | `public/firmware/` (Stage 2 line 67) | `.uf2` extract → copy | WIRED (code) + human-check (build) | Line 28 unzip step lands `.uf2` in `/firmware/`. Line 67 `COPY --from=firmware /firmware/ ./public/firmware/` — same COPY as `.factory.bin`. Actual artifact presence deferred to `docker build`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `use-flash.ts` `.progress` | `active.progress` (from delegate hook) | `useFlashEsp32().progress` OR `useFlashNrf52().progress` | Yes — each delegate maintains its own `useState<FlashProgress>` populated during pipeline stages | FLOWING |
| `use-flash-nrf52.ts` `firmware` | `firmware` local | `await loadUf2(device)` returning `Uint8Array` from `fetch(/firmware/{filename})` | Yes — real fetch of a real UF2 artifact served from public/firmware/. UF2 presence itself depends on Docker build (see human-check). | FLOWING (in prod after successful docker build) |
| `use-dfu.ts` `dfuDevice` | `dfuDeviceRef.current` / `dfuDevice` state | `await openDfu(usbDevice)` after `navigator.usb.requestDevice(...)` | Yes — real USBDevice from browser Web USB picker | FLOWING (requires physical device — human-check) |
| `use-flash-nrf52.ts` `writePercent` | `progress.writePercent` | `reportProgress(written, total)` callback fired inside `dfuWrite` loop | Yes — driven by DFU block loop in `web-dfu.ts:151-169` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly | `cd apps/run.flash/webapp && npx tsc --noEmit` | Exit code 0, no output | PASS |
| Next.js production build succeeds | `cd apps/run.flash/webapp && NEXT_PUBLIC_FIRMWARE_VERSION=0.0.0 npx next build` | `✓ Compiled successfully in 11.9s`, 7 static pages, 4 dynamic routes | PASS |
| DPLY-06 offline-gate: no meshtastic hostnames in client bundle | `grep -rE 'api\.meshtastic\.org\|github\.com/meshtastic' .next/standalone .next/static \| wc -l` | 0 | PASS |
| ESP32 delegate zero-diff since Plan 24-01 landing | `git diff bd8c828f..HEAD -- src/hooks/use-flash-esp32.ts src/hooks/use-serial.ts src/lib/esptool.ts \| wc -l` | 0 | PASS |
| useFlashNrf52 stub error absent | `grep -rn "nRF52 flash not yet implemented" apps/run.flash/webapp/src/` | (no output) | PASS |
| RECOMMENDED_SLUGS remains at 5 ESP32 slugs | `grep -cE '"HELTEC_V3"\|"TBEAM"\|"TLORA_V2_1_1P6"\|"RAK4631"\|"STATION_G2"' src/config/devices.ts` | 5 | PASS |
| Dockerfile Stage 1 nrf52840 admittance | `grep -c 'nrf52840' apps/run.flash/webapp/Dockerfile.webapp` | 2 (ARCH loop + jq filter) | PASS |
| DFU library types installed | `test -f apps/run.flash/webapp/node_modules/@types/w3c-web-usb/index.d.ts` | file present | PASS |
| Docker build against Meshtastic stable | `docker build --no-cache -f Dockerfile.webapp ...` | — | SKIP — no docker daemon in sandbox → human verification |
| Hardware DFU flash on T-1000E | (Chrome/Edge + physical T-1000E + double-tap RST) | — | SKIP — no USB / no browser / no hardware → human verification |

### Probe Execution

Not applicable — this phase produces no `scripts/*/tests/probe-*.sh` and the PLAN/SUMMARY files do not reference any probe scripts. Verification is performed via TypeScript compilation, Next.js build, DPLY-06 grep gate, and git-diff evidence — all executed above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEVC-07 | 024-01, 024-02 | Device-family discriminator (router extraction + fail-fast on unknown architectures) | SATISFIED | `getDeviceFamily(device)` in `types/device.ts:45-49` returns `"esp32"` / `"nrf52"` and throws on unknown. Router in `use-flash.ts:73` dispatches by return value. Note: DEVC-07 is not currently listed in `.planning/REQUIREMENTS.md` — the ID is workstream-scoped (v1-4-1-nrf52840 ROADMAP + CONTEXT). |
| FLSH-09 | 024-02 | nRF52 UF2 / Web USB DFU write path | SATISFIED (code) + hardware human-check | `web-dfu.ts` implements DFU 1.1 host (openDfu/dfuWrite/dfuVerify/closeDfu/getDfuErrorMessage). `use-dfu.ts` wraps Web USB connection. `useFlashNrf52` runs 2-stage `writing → verifying → complete` pipeline. Hardware write to T-1000E deferred to Phase 25 SC4 human verification. Not currently listed in `.planning/REQUIREMENTS.md` (workstream-scoped ID). |
| DPLY-07 | 024-01, 024-02 | Dockerfile Stage 1 extension for nrf52840 architecture + `.uf2` extract + hardware-list filter | SATISFIED (code) + docker-build human-check | Dockerfile.webapp lines 23 / 28 / 39 all present. Local `next build` + DPLY-06 grep gate: PASS. Docker build reproduction deferred to human verification (no docker daemon). Not currently listed in `.planning/REQUIREMENTS.md` (workstream-scoped ID). |
| DPLY-06 | (existing v1.4 gate, re-validated this phase) | Offline-at-event guarantee — no runtime fetch to api.meshtastic.org / github.com/meshtastic in `.next/standalone` or `.next/static` | SATISFIED | Post-`next build` grep against `.next/standalone` + `.next/static` returns 0 hits (verified in this sandbox). Dockerfile.webapp lines 96-98 grep gate untouched. Defined in `.planning/REQUIREMENTS.md`. |

**Note on requirement IDs:** DEVC-07, FLSH-09, and DPLY-07 are referenced by both the workstream ROADMAP.md and both PLAN.md frontmatter but are not currently defined in the milestone-agnostic `.planning/REQUIREMENTS.md`. They function as workstream-scoped identifiers here (introduced with v1.4.1). No blocker — the requirements are anchored in ROADMAP success criteria and PLAN frontmatter, both of which have been verified. Reviewer may want to append canonical definitions to `.planning/REQUIREMENTS.md` at v1.4.1 close-out.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/config/devices.ts` | 21 | Pre-existing `TODO: Update this list once event hardware is finalized` | Info | Untouched by Phase 24 (predates workstream). Companion to the new TODO immediately below it. |
| `src/config/devices.ts` | 23 | `TODO(v1.4.1 close-out): promote T-1000E (hwModelSlug SEEED_TRACKER_T1000_E) after Phase 25 SC4 hardware verify.` | Info | Explicitly required by CONTEXT Decision 5 + PLAN 24-01 Task 1 Step B. References formal follow-up (`Phase 25 SC4`) — satisfies the debt-marker gate. |
| `src/lib/web-dfu.ts` | 389 | `export const _DFU_ABORT_REQUEST = DFU_ABORT;` (tree-shake anti-removal hint) | Info | Intentional — prevents constant-only export from being dead-code-eliminated by esbuild. Marked "internal" in comment. |
| `src/hooks/use-flash.ts` | 76-78 | Type-cast `transport as ESPLoader` / `transport as DfuDevice` | Info | Intentional per PLAN 24-02 Task 2 Step D — the router accepts a discriminated union; delegate-specific casts happen at dispatch. Not a bypass; router already enforces family membership via `getDeviceFamily`. |

No `TBD` / `FIXME` / `XXX` debt markers found in any phase-modified file. No stub returns (`return null` / `return []` / `return {}`). No empty handler (`onClick={() => {}}`) patterns. No hardcoded placeholder strings in user-facing paths.

### Human Verification Required

The following items cannot be verified programmatically in this sandbox. All are surfaced to the developer/user for physical or docker-daemon verification. Per Kurt's directive, hardware-in-loop items are NOT scored green — they must be resolved on real hardware.

#### 1. Docker build against Meshtastic stable — verify Stage 1 extracts nrf52840 zip + .uf2 artifacts

**Test:** Run docker build in an environment with a docker daemon and network access to `api.meshtastic.org` / `github.com/meshtastic`:
```bash
docker build --no-cache -f apps/run.flash/webapp/Dockerfile.webapp \
  -t dc34-run-flash-app:phase24-verify apps/run.flash/webapp/ \
  2>&1 | tee /tmp/build24-verify.log | grep -qE 'Extracted [0-9]+ firmware binaries'
```

**Expected:** Build succeeds. Stage 1 log line reports `Extracted N firmware binaries` where N includes `.uf2` files (the phase-24 Dockerfile edit at line 32 now counts both `.factory.bin` + `.uf2`).

**Why human:** No docker daemon in this sandbox (`command -v docker` returns absent). Requires network egress to Meshtastic release infrastructure.

#### 2. Verify built image ships T-1000E hardware-list entry + at least one .uf2

**Test:** After (1) succeeds:
```bash
docker run --rm dc34-run-flash-app:phase24-verify sh -c \
  'grep -c "_T1000_E" /app/public/data/hardware-list.json && \
   ls /app/public/firmware/ | grep -cE "\.uf2$"'
```

**Expected:** hardware-list.json contains at least one T-1000E family slug; at least one `firmware-*.uf2` file present in `/app/public/firmware/`.

**Nomenclature caveat:** The SUMMARY.md files and the phase-24 TODO comment in `src/config/devices.ts` both reference the slug as `SEEED_TRACKER_T1000_E`. The committed hardware-list.json snapshot (last regenerated 6 months ago per `git log`) contains the slug as `TRACKER_T1000_E`. Reviewer should confirm which slug the current Meshtastic stable release ships and update the TODO comment in `src/config/devices.ts` if it doesn't match — this is a comment-only nomenclature issue, not a code-side blocker.

**Why human:** Depends on docker build (see 1).

#### 3. Hardware-in-loop: T-1000E DFU write completes and device boots into new firmware

**Test:**
1. Put a physical T-1000E in bootloader mode (double-tap the RESET button)
2. Plug USB into a host with Web USB (Chrome/Edge on Linux/macOS/Windows)
3. Open the deployed `flash.defcon.run` (or `npm run dev` locally with the built firmware artifacts in `public/firmware/`)
4. Click Connect on the T-1000E device row — confirm browser USB picker offers the T-1000E and `openDfu()` succeeds (`connectionState === "connected"`, log shows `DFU interface claimed. Ready to flash.`)
5. Click Flash — confirm console shows `=== Stage 1/2: Writing firmware over DFU ===`, `writePercent` climbs 0→100, then `=== Stage 2/2: Verifying DFU status ===`, then `DFU status OK — device is in dfuIDLE.` and `=== Flash complete! ===`
6. After flash, T-1000E auto-resets; verify Meshtastic client can talk to the newly-flashed device within ~5s

**Expected:** All six steps succeed. Device joins mesh after replug (SC4 completion signal).

**Why human:** Sandbox has no USB, no Web USB browser, no T-1000E hardware. This is Phase 24 ROADMAP SC4 hardware-in-loop and belongs to Phase 25's hardware pass per CONTEXT Constraints ("No hardware in this sandbox — SC4's 'successfully writes .uf2 to T-1000E' cannot be validated here"). Per Kurt's directive in this workstream: hardware SCs surface here, NOT falsely scored green.

#### 4. Failure-mode spot-checks on Web USB DFU

**Test:**
- Cancel the USB picker → `connectionState` returns to `disconnected`, no error toast (mirrors useSerial NotAllowedError silent-return at `use-dfu.ts:118-121`)
- Unplug device during flash → error toast reads `USB connection lost. Unplug the device, plug it back in, and try again.` (from `getDfuErrorMessage` in `web-dfu.ts:253-255`)
- `.uf2` file missing under `/firmware/` (e.g., Docker build didn't extract) → error reads `UF2 firmware not found for {displayName}. Expected file: firmware-{target}-{version}.uf2 (HTTP 404).` (from `loadUf2` in `config/firmware.ts:103-107`)

**Expected:** Each failure mode surfaces the mapped `getDfuErrorMessage` / `loadUf2` output as designed.

**Why human:** Requires live browser + physical unplug during flash + a curated fixture where the `.uf2` is absent. Cannot exercise Web USB error paths without a browser + device.

#### 5. Positive-control ESP32 regression on Phase 19 Recommended set

**Test:** Flash any of `HELTEC_V3` / `TBEAM` / `TLORA_V2_1_1P6` / `RAK4631` / `STATION_G2` end-to-end and confirm erase → write → verify still runs with no copy or UX regression.

**Expected:** No behavioural, timing, or copy regression against v1.4-shipped ESP32 flash flow.

**Why human:** ESP32 code-side zero-regression is enforced by construction (see SC4 evidence — `git diff bd8c828f..HEAD -- use-flash-esp32.ts use-serial.ts lib/esptool.ts` returns 0 lines), but user-observable regression against real hardware still requires a physical positive-control run. Phase 25 SC5 hardware companion.

### Gaps Summary

No blocking programmatic gaps found. All five ROADMAP Phase 24 success criteria are code-side verified in this sandbox:

- **SC3** (family router) and **SC5** (build + tsc + DPLY-06 offline gate) are fully VERIFIED end-to-end — the router with `getDeviceFamily` dispatch exists and works, TypeScript compiles clean, `next build` succeeds, and the DPLY-06 grep gate returns 0 hits.
- **SC4** is SPLIT: ESP32 zero-regression is enforced by construction (git diff proves zero changes to the ESP32 delegate since Plan 24-01 extract), and the nRF52 code-side pipeline is complete (2-stage `writing → verifying → complete`, `dfuWrite` + `dfuVerify` wired, no stub error remaining). The hardware-in-loop portion is surfaced under Human Verification Required item 3.
- **SC1** and **SC2** are code-side VERIFIED (jq filter admits nrf52840, `.uf2` unzip step present, RECOMMENDED_SLUGS preserved at 5 ESP32 slugs). The runtime artifact verification (hardware-list.json contains T-1000E slug + built image contains `.uf2`) requires `docker build` and is surfaced under Human Verification Required items 1-2. Local `next build` + DPLY-06 grep gate reproduction in this sandbox already confirms the offline guarantee holds.

One informational nomenclature note: the phase-24 TODO comment in `src/config/devices.ts` references the T-1000E slug as `SEEED_TRACKER_T1000_E` but the committed hardware-list.json snapshot uses `TRACKER_T1000_E`. This is a comment-only issue for Phase 25 close-out to reconcile — it does not affect any code path (the promotion-to-Recommended is intentionally deferred).

**Status resolution:** `status: human_needed`. Five must-haves scored VERIFIED code-side; three human-verification items (2 docker-build gates + 1 hardware-in-loop DFU write) remain, plus companion failure-mode and ESP32-positive-control checks. Not `passed` because hardware/docker gates cannot resolve in sandbox.

---

*Verified: 2026-07-02*
*Verifier: Claude (gsd-verifier), goal-backward verification mode*
