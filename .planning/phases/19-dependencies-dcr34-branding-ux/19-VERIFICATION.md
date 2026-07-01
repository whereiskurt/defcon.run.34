---
phase: 19-dependencies-dcr34-branding-ux
verified: 2026-07-01T00:00:00Z
status: human_needed
score: 8/10 must-haves verified (2 hardware-in-loop deferred to human)
overrides_applied: 0
human_verification:
  - test: "Hardware-in-loop end-to-end regression on Recommended ESP32 with bumped esptool-js 0.6.0 stack"
    expected: "Pick → Connect → Flash → Configure → Done completes cleanly; device boots, joins mesh, appears in `meshtastic --info` or Done step confirmation"
    why_human: "Requires physical ESP32 (HELTEC_V3/TBEAM/TLORA_V2_1_1P6/RAK4631/STATION_G2) + Chrome/Edge browser with Web Serial; cannot be exercised in sandbox. Per Kurt directive: hardware SCs never scored green programmatically."
  - test: "tlora-t3s3 flash confirmation with flashMode 'dio'"
    expected: "tlora-t3s3 board flashes and boots cleanly with the explicit `flashMode: 'dio'` branch active; no bricked-on-boot regression"
    why_human: "Requires physical tlora-t3s3 hardware. If unavailable, code review of `apps/run.flash/webapp/src/hooks/use-flash.ts:104-106` (commit c0aeccd8) is the documented fallback per Plan 19-01."
  - test: "Visual pass: DCR34 firmware identity in Flash step"
    expected: "Flash step summary card shows `run.defcon.run firmware` as the primary label and `Meshtastic {resolved-version}` as the subtitle in existing text-default-500 monospace treatment; screenshot for release folder"
    why_human: "In-context visual verification — sandbox can grep the strings and confirm JSX shape, but cannot judge how the two-line block reads visually in the running app."
  - test: "Error-state pass: cancelled / in-use / no-response / chip-mismatch categories fire correctly"
    expected: |
      (1) Browser serial prompt cancel → panel stays on 'Ready to connect', no scary banner, button still 'Connect Device'.
      (2) Port held by another app (Arduino IDE / PlatformIO / another tab) → 'serial port is in use' copy fires with BootloaderHelp visible.
      (3) Charge-only cable or mid-connect disconnect → 'Couldn't reach the device' copy fires with BootloaderHelp visible.
      (4) Mis-select device in picker (e.g. heltec-v3 chosen, tbeam plugged in) → ChipMismatchWarning fires with actionable single-sentence corrective copy naming both sides of the mismatch.
    why_human: "Requires real-world serial failure conditions or a well-staged mock. Classifier logic can be grep-verified, but category matching against upstream getConnectionErrorMessage output shape needs live confirmation."
  - test: "Bootloader-help outbound link + auto-bootloader note in-context"
    expected: "Expanding BootloaderHelp shows the tightened intro copy, the 6-step troubleshooting list (with the auto-bootloader note at step 3 and the manual BOOT/RESET fallback at step 4), and clicking the outbound link opens meshtastic.org/docs/getting-started/flashing-firmware/"
    why_human: "Sandbox cannot follow the external link to confirm the URL still resolves to the canonical Meshtastic flashing docs page."
---

# Phase 19: Dependencies & DCR34 Branding/UX Verification Report

**Phase Goal:** The flasher runs on bumped Meshtastic/esptool dependencies with no regression, and presents a cohesive DCR34 "run.defcon.run firmware" identity with connect, bootloader-help, and error UX aligned to current flasher.meshtastic.org patterns.

**Verified:** 2026-07-01
**Status:** human_needed
**Re-verification:** No — initial verification
**Branch:** `gsd/phase-19-dependencies-dcr34-branding-ux`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `@meshtastic/core`, `@meshtastic/transport-web-serial`, and `esptool-js` pinned to latest compatible versions | VERIFIED | `apps/run.flash/webapp/package.json:16-17,23` — `@meshtastic/core ^2.6.7`, `@meshtastic/transport-web-serial ^0.2.5`, `esptool-js ^0.6.0`; lockfile confirms `node_modules/esptool-js@0.6.0` resolved; `npm view` on 2026-07-01 confirms 2.6.7 and 0.2.5 are npm-latest for the two Meshtastic pins (documented in 19-01 SUMMARY decision #1). |
| 2 | `npx tsc --noEmit` passes against bumped versions with no type breakages | VERIFIED | `npx tsc --noEmit` in `apps/run.flash/webapp/` exits 0 at verification time. Two API-shape breakages (removed `LoaderOptions.romBaudrate` and `FlashOptions.fileArray[].data` string→Uint8Array) were adapted at call sites per plan Task 1 action (commit `5d43f345`). |
| 3 | tlora-t3s3 → flashMode 'dio' quirk preserved as narrow conditional | VERIFIED | `apps/run.flash/webapp/src/hooks/use-flash.ts:104-106` — one-line comment + `let flashMode: "dio" \| "keep" = "keep"` default + narrow `if (device.platformioTarget === "tlora-t3s3") flashMode = "dio"`; passed as `flashMode` prop into `writeFlash` at line 108-112. No lookup table, no per-device config framework. |
| 4 | Pick → Connect → Flash → Configure → Done completes end-to-end against Recommended ESP32 (no regression on bumped stack) | HARDWARE — HUMAN | Cannot be exercised in sandbox — see Human Verification Required. |
| 5 | tlora-t3s3 → flashMode 'dio' actually flashes a physical tlora-t3s3 board successfully | HARDWARE — HUMAN | Cannot be exercised in sandbox — see Human Verification Required. Code review of the branch at commit `c0aeccd8` is the documented fallback if hardware unavailable. |
| 6 | Flash step displays firmware as `run.defcon.run firmware` with `Meshtastic {FIRMWARE_VERSION}` subtitle, replacing the previous bare `Firmware {version}` line | VERIFIED | `apps/run.flash/webapp/src/components/flash/flash-step.tsx:127-135` — two-line block with `run.defcon.run firmware` (primary, font-mono text-foreground) + `Meshtastic {FIRMWARE_VERSION}` (subtitle, font-mono text-default-500 text-xs). `FIRMWARE_VERSION` imported at line 16 from `@/config/firmware` — unchanged wiring per 19-01 contract. |
| 7 | Other firmware-name surfaces use the same identity string (Done step: intentionally untouched because it never named the firmware) | VERIFIED | `done-step.tsx` grep for `run.defcon.run firmware` / `Meshtastic` / `firmware` confirms the file only mentions "Meshtastic app" (line 248, referring to the mobile app, not the firmware). Plan explicitly says "If it does NOT currently name the firmware, leave `done-step.tsx` unchanged — do not invent a new surface just to add branding." Decision honored. |
| 8 | Bootloader-help gives clear DFU/bootloader guidance framed as troubleshooting for a serial-connect failure, with auto-bootloader note and preserved outbound link | VERIFIED | `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx:22-79` — accordion retitled "Serial connect failed? Try these"; scoped intro at line 30-34; 6-step list with auto-bootloader note at step 3 (lines 46-51) and manual BOOT/RESET fallback at step 4 (lines 52-58); outbound link at line 69-77 pointing to `https://meshtastic.org/docs/getting-started/flashing-firmware/`. |
| 9 | Chip-mismatch warning names concrete failure (detected vs. expected chip family) and points at a single corrective action | VERIFIED | `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx:31-46` — paragraph 1 names detected chip + selected picker device + brick risk; paragraph 2 is a single-sentence corrective action naming the picker and the alternative device. Prop signature unchanged; no-proceed-button behavior preserved. |
| 10 | Serial-error copy in Connect step is actionable — errors categorized (cancelled / in-use / no-response / generic) rather than raw exception messages | VERIFIED | `apps/run.flash/webapp/src/components/connect/connect-step.tsx:48-109` — `ConnectErrorCategory` type + `classifyConnectError()` (lines 50-88, matches on "no port selected"/"cancel"/"already in use"/"invalidstateerror"/"timeout"/"no compatible device"/etc.) + `categoryMessage()` (lines 90-109). Cancelled path reverts to "Ready to connect" UI silently (line 134, 150). All other error categories show BootloaderHelp (line 272). Inline helpers per plan constraint — no new module, no i18n. |

**Score:** 8/10 truths verified programmatically; 2 hardware-in-loop truths (SCs 1 and 2) routed to Human Verification Required per Kurt directive.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.flash/webapp/package.json` | Bumped Meshtastic/esptool pins | VERIFIED | `esptool-js ^0.6.0`; `@meshtastic/core ^2.6.7` and `@meshtastic/transport-web-serial ^0.2.5` unchanged because already at npm-latest (documented decision). |
| `apps/run.flash/webapp/package-lock.json` | Deterministic resolution of bumped deps | VERIFIED | `esptool-js@0.6.0` resolved at `node_modules/esptool-js` in lockfile (line 8630-8632). |
| `apps/run.flash/webapp/src/hooks/use-flash.ts` | tlora-t3s3 flashMode override + esptool-js 0.6.0 Uint8Array adaptation | VERIFIED | Both changes present (lines 97-102 Uint8Array, 104-112 flashMode branch); passes tsc. |
| `apps/run.flash/webapp/src/lib/esptool.ts` | esptool-js 0.6.0 LoaderOptions.romBaudrate removal | VERIFIED | `romBaudrate` line removed from ESPLoader constructor (lines 55-59); comment at line 52-54 documents that loader pins ROM baud to 115200 internally. Behavioral no-op. |
| `apps/run.flash/webapp/src/components/flash/flash-step.tsx` | BRND-01 firmware identity display | VERIFIED | `run.defcon.run firmware` at line 130; `Meshtastic {FIRMWARE_VERSION}` subtitle at line 133; unchanged FIRMWARE_VERSION import wiring at line 16. |
| `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx` | BRND-02 DFU/bootloader guidance | VERIFIED | Tightened intro + auto-bootloader step + manual fallback step + preserved outbound link. Signature unchanged. |
| `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx` | BRND-02 chip-mismatch messaging | VERIFIED | Single-sentence corrective action naming picker; both sides of mismatch named up front. Prop signature unchanged. |
| `apps/run.flash/webapp/src/components/connect/connect-step.tsx` | BRND-02 actionable serial-error copy | VERIFIED | Inline classifier + categoryMessage + cancelled defensive path + BootloaderHelp gating. No new module introduced. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `use-flash.ts` | `esptool-js` (ESPLoader.writeFlash) | `writeFlash({ flashMode, ... })` | WIRED | Derived `flashMode` variable declared line 105-106, passed as `flashMode` prop in `writeFlash` options at line 108-112. |
| `use-flash.ts` | `device.platformioTarget` | narrow conditional | WIRED | `if (device.platformioTarget === "tlora-t3s3")` at line 106 matches the same field `getFactoryFilename` uses in `src/config/firmware.ts` — no new lookup abstraction. |
| `flash-step.tsx` | `src/config/firmware.ts` | `FIRMWARE_VERSION` import | WIRED | Import at line 16; consumed in subtitle at line 133; unchanged from 19-01 contract. |
| `connect-step.tsx` | `bootloader-help.tsx` | `<BootloaderHelp/>` render | WIRED | Import at line 9; rendered at line 272 when `showErrorPanel` is true (any non-cancelled error). |
| `connect-step.tsx` | `chip-mismatch.tsx` | `<ChipMismatchWarning/>` render | WIRED | Import at line 8; rendered at lines 210-217 when `isConnected && chipMismatch && chipInfo && device`; props (`detectedChipName`, `expectedArchitecture`, `deviceName`) all supplied. |
| `connect-step.tsx` (error render) | `classifyConnectError` + `categoryMessage` | inline helpers | WIRED | `errorCategory` computed at line 130-133; `displayError` at line 135-138; rendered at line 174-178 in the error panel. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `flash-step.tsx` firmware subtitle | `FIRMWARE_VERSION` | `src/config/firmware.ts` — `process.env.NEXT_PUBLIC_FIRMWARE_VERSION` build-injected via Phase 18-01 pipeline | Yes (in production; stub-injected in dev) | FLOWING |
| `use-flash.ts` `flashMode` | `device.platformioTarget` string | `DeviceHardware` prop from wizard state → device picker → `RECOMMENDED_SLUGS` + hardware-list JSON generated by Phase 18-02/03 | Yes | FLOWING |
| `connect-step.tsx` `displayError` | `serial.error` string | `useSerial` hook via `getConnectionErrorMessage()` in `src/lib/esptool.ts` (unchanged; classifier matches on the processed strings this function produces) | Yes | FLOWING |
| `chip-mismatch.tsx` props | `detectedChipName`, `expectedArchitecture`, `deviceName` | `serial.chipInfo.chipName` (from `espLoader.chip.CHIP_NAME`), `device.architecture`, `device.displayName` — all real chip/device values | Yes | FLOWING |

No hollow props, no hardcoded empty renders in the modified files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript type-check passes on bumped stack | `cd apps/run.flash/webapp && npx tsc --noEmit; echo EXIT=$?` | `EXIT=0` (no output, clean exit) | PASS |
| Branding string reachable in Flash step JSX | `grep -c "run.defcon.run firmware" apps/run.flash/webapp/src/components/flash/flash-step.tsx` | 1 (line 130) | PASS |
| tlora-t3s3 branch present at writeFlash call site | `grep -n "tlora-t3s3" apps/run.flash/webapp/src/hooks/use-flash.ts` | Lines 104, 106 | PASS |
| Bootloader-help contains BOOT sequence | `grep -c "BOOT" apps/run.flash/webapp/src/components/connect/bootloader-help.tsx` | Multiple (step 4 fallback + intro references) | PASS |
| Chip-mismatch includes detectedChipName prop | `grep -c "detectedChipName" apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx` | 3 (prop declaration + destructure + template use) | PASS |
| Connect-step categorizes errors | `grep -Eq "in use\|classify\|cancelled" apps/run.flash/webapp/src/components/connect/connect-step.tsx` | Matches (multiple sites) | PASS |
| Installed dep versions match pinned range | `grep '"version"' node_modules/{esptool-js,@meshtastic/core,@meshtastic/transport-web-serial}/package.json` | `0.6.0`, `2.6.7`, `0.2.5` | PASS |
| Full `npm run build` on bumped stack | Not run at verification — plan already ran it in Task 1 (commit 5d43f345) and Task 2 (commit be274ad8) with `NEXT_PUBLIC_FIRMWARE_VERSION=<stub>`; SUMMARY documents PASS both times. Re-running would require `.env.local` from `scripts/download-firmware.sh` which fetches from `api.meshtastic.org` (out-of-sandbox network). | Not re-run in sandbox | SKIP (documented in SUMMARY; type-check re-run above stands in for build gate at verification time) |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (none declared) | — | — | N/A |

No `scripts/*/tests/probe-*.sh` conventional probes exist in the repo (verified via `find scripts -path '*/tests/probe-*.sh'` yields no results) and no probe paths are declared in the Phase 19 PLAN/SUMMARY files. Not applicable to this phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEPS-01 | 19-01 | Bump `@meshtastic/core`, `@meshtastic/transport-web-serial`, `esptool-js` to latest compatible versions; carry over `tlora-t3s3 → flashMode 'dio'` quirk; full pick→connect→flash→configure→done works with no regression | SATISFIED (code) + NEEDS HUMAN (hardware regression) | esptool-js `^0.6.0`; Meshtastic pins at npm-latest; tlora-t3s3 branch present at use-flash.ts:104-106; type-check clean. Hardware regression verification deferred to Human. |
| BRND-01 | 19-02 | UI presents firmware as `run.defcon.run firmware` with underlying Meshtastic version as subtitle (`run.defcon.run firmware · Meshtastic {version}`) replacing generic Meshtastic version strings | SATISFIED | flash-step.tsx:127-135 renders the two-line block via existing FIRMWARE_VERSION import; done-step correctly left unchanged per plan constraint. |
| BRND-02 | 19-02 | Connect, bootloader-help, and error-state UX aligned with current flasher.meshtastic.org patterns (bootloader/DFU guidance, chip-mismatch messaging, actionable serial-error copy) | SATISFIED (code) + NEEDS HUMAN (visual + error-state pass) | bootloader-help.tsx tightened + auto-bootloader note + valid outbound link; chip-mismatch.tsx single-sentence corrective action naming picker; connect-step.tsx four-category classifier. In-context UX quality routed to Human. |

No orphaned requirements — REQUIREMENTS.md maps DEPS-01/BRND-01/BRND-02 to Phase 19 and all three are claimed by the plans that ran.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | Grep for `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER\|placeholder\|coming soon\|not yet implemented` across the six modified files (`flash-step.tsx`, `bootloader-help.tsx`, `chip-mismatch.tsx`, `connect-step.tsx`, `use-flash.ts`, `esptool.ts`) returned no matches. Zero debt markers introduced by this phase. |

Notes on pre-existing scope items documented in 19-01 SUMMARY but NOT introduced by this phase:
- `npm run lint` fails on pre-existing `eslint-config-next` / `@eslint/eslintrc` circular-JSON incompatibility. Predates Phase 19; `next build` runs TypeScript checking internally and still passes.
- `npm audit` reports 9 pre-existing vulnerabilities (1 low, 4 moderate, 4 high). None in `esptool-js` or the bumped stack; inherited from prior tree. Out of scope for Phase 19.

Both are non-blockers for Phase 19 goal achievement and appropriately routed to future targeted plans.

### Human Verification Required

Hardware-in-loop items — per Kurt directive these are NOT scored as pass programmatically; they must be exercised by the developer on real hardware in a Chrome/Edge browser with Web Serial.

#### 1. End-to-end regression on Recommended ESP32 (SC 1)

**Test:** Build the flasher (`cd apps/run.flash/webapp && ./scripts/download-firmware.sh && npm run dev` — or `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/`). Open in Chrome/Edge. Pick any Recommended ESP32 (HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, or STATION_G2). Complete Pick → Connect → Flash → Configure → Done.
**Expected:** Device flashes with the vendored factory image, boots (LED activity), joins mesh, and appears in `meshtastic --info` or the Done step's "device connected" confirmation. No regression from esptool-js 0.6.0 API changes surfacing at runtime.
**Why human:** Requires physical ESP32 + Chrome/Edge with Web Serial; cannot be exercised in sandbox. Same pattern as Phase 18's FLSH-08 hardware-in-loop blocker.

#### 2. tlora-t3s3 flashMode 'dio' hardware confirmation (SC 2)

**Test:** Repeat the above with a `tlora-t3s3` board selected in the picker.
**Expected:** tlora-t3s3 flashes and boots cleanly — the `flashMode: 'dio'` branch prevented the bricked-on-boot regression that a default `'keep'` would have triggered.
**Why human:** Requires physical tlora-t3s3 hardware. Fallback per plan `<how-to-verify>` step 6: code review of `apps/run.flash/webapp/src/hooks/use-flash.ts:104-106` (commit `c0aeccd8`) is acceptable if no board available.

#### 3. Visual pass: DCR34 firmware identity (SC 3)

**Test:** On the running flasher, walk Pick → Connect → Flash. Inspect the Flash step summary card's Firmware row.
**Expected:** Primary label reads exactly `run.defcon.run firmware`; subtitle reads `Meshtastic {resolved-version}` in existing monospace/text-default-500 treatment. Right-aligned two-line stack. Screenshot for release folder.
**Why human:** In-context visual verification — sandbox can grep the strings and confirm JSX shape, but cannot judge visual rhythm in the running app.

#### 4. Error-state pass: category classifier fires correctly (SC 4)

**Test:**
1. Trigger browser serial prompt → Cancel → confirm panel stays on "Ready to connect", no scary banner, button still `Connect Device`.
2. Open the device in another tab or Arduino Serial Monitor → attempt to connect → confirm "The serial port is in use by another program…" copy fires with BootloaderHelp visible.
3. Attach a charge-only USB cable or disconnect mid-connect → confirm "Couldn't reach the device…" copy fires with BootloaderHelp visible.
4. Select `heltec-v3` in picker but plug in a `tbeam` → confirm ChipMismatchWarning fires with the actionable single-sentence corrective copy.
**Expected:** Each category fires the correct copy with BootloaderHelp visible for non-cancelled paths.
**Why human:** Requires real-world serial failure conditions or a well-staged mock. Classifier logic is grep-verified but category matching against upstream `getConnectionErrorMessage` output shape needs live confirmation.

#### 5. Bootloader-help in-context + outbound link (SC 4)

**Test:** Expand the BootloaderHelp accordion (from any non-cancelled error state).
**Expected:** Auto-bootloader note is present at step 3; manual BOOT/RESET fallback is at step 4; outbound link opens `https://meshtastic.org/docs/getting-started/flashing-firmware/` and lands on the current Meshtastic flashing docs page.
**Why human:** Sandbox cannot follow the external link to confirm the URL still resolves to the canonical docs page.

### Gaps Summary

No programmatic gaps. The phase goal's code-visible dimensions — dependency bumps, tlora-t3s3 quirk preservation, DCR34 firmware identity string, bootloader-help tightening, chip-mismatch actionable copy, and serial-error categorization — are all verified in the codebase against the modified files listed by each plan's SUMMARY. TypeScript type-check passes clean on the bumped stack. No debt markers introduced. All key link wiring intact.

What remains: the phase's two hardware-in-loop success criteria (SC 1: no-regression end-to-end on a Recommended ESP32; SC 2: tlora-t3s3 boot confirmation) plus the in-context visual and error-state verification for BRND-01/BRND-02. These are appropriately routed to Human Verification Required and do not signal a code gap — they are the standard closure path for this type of phase, matching Phase 18's FLSH-08 hardware pattern.

Status is `human_needed` (not `passed`) because the human_verification section is non-empty per Step 9 decision tree.

---

*Verified: 2026-07-01*
*Verifier: Claude (gsd-verifier)*
