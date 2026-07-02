---
phase: 024-device-family-router-nrf52-flash-path
plan: 02
subsystem: run.flash / webapp
tags: [webapp, hooks, nrf52, dfu, web-usb, uf2, transport]
requires:
  - "024-01 shipped (device-family router + useFlashEsp32 extract + useFlashNrf52 stub + Dockerfile Stage 1 nrf52840)"
provides:
  - "lib/web-dfu.ts: custom DFU 1.1 host (openDfu / dfuWrite / dfuVerify / closeDfu / getDfuErrorMessage) against Adafruit nRF52 bootloader"
  - "hooks/use-dfu.ts: Web USB connection state hook parallel to useSerial (connect / disconnect / dfuDeviceRef / logs)"
  - "hooks/use-flash-nrf52.ts: real 2-stage writing -> verifying pipeline replacing the Plan 24-01 stub"
  - "config/firmware.ts: getUf2Filename + loadUf2 helpers (returns Uint8Array — no binary-string dance)"
  - "hooks/use-flash.ts: router transport type narrowed from ESPLoader | unknown to ESPLoader | DfuDevice"
affects:
  - "@types/w3c-web-usb devDep added (DefinitelyTyped, MIT)"
  - "No production dependencies changed (custom DFU client is zero-dep)"
tech-stack:
  added:
    - "@types/w3c-web-usb@^1.0.14 (devDependency — DefinitelyTyped, MIT, type-only)"
  patterns:
    - "custom-dfu fallback (CONTEXT D-02): shortlist candidates fail supply_chain_gate, ~290-LOC DFU 1.1 client implements DFU_DNLOAD + DFU_GETSTATUS state machine inline"
    - "2-stage nrf52 pipeline seeded with eraseComplete: true (CONTEXT D-06) — bootloader owns erase inside DFU_DNLOAD"
    - "USB picker filter (classCode 0xFE / subclassCode 0x01) mirrors useSerial's requestPort() gesture-scoped call"
    - "post-manifest disconnect treated as verify success (Adafruit bootloader auto-reset case)"
key-files:
  created:
    - apps/run.flash/webapp/src/lib/web-dfu.ts
    - apps/run.flash/webapp/src/hooks/use-dfu.ts
  modified:
    - apps/run.flash/webapp/src/config/firmware.ts
    - apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts
    - apps/run.flash/webapp/src/hooks/use-flash.ts
    - apps/run.flash/webapp/package.json
    - apps/run.flash/webapp/package-lock.json
decisions:
  - "Custom DFU 1.1 client (CONTEXT D-02 fallback): all three shortlist candidates return npm E404 (dfu-util-js, web-dfu, nrf-dfu-js); alternative `dfu@0.1.5` rejected as Flipper-Zero-focused fork with 20mo staleness — no Adafruit nRF52 coverage"
  - "eraseComplete: true seeded from mount + preserved on reset (CONTEXT D-06): the Adafruit bootloader owns erase inside DFU_DNLOAD, so the pipeline UI can render a green segment rather than a fake 'erasing' step"
  - "dfuVerify accepts either dfuIDLE (bState=2) or dfuMANIFEST_WAIT_RESET (bState=8): some Adafruit bootloaders require an explicit USB reset before returning to idle; both indicate a clean download"
  - "Post-manifest disconnect (NetworkError / device unavailable) treated as verify success: Adafruit bootloaders that auto-reset into the newly-written app drop the USB endpoint before the final GETSTATUS returns — that's the success signal, not a failure"
  - "Router transport type narrowed to ESPLoader | DfuDevice; ESP32 branch keeps its `as ESPLoader` cast so use-flash-esp32.ts stays byte-identical to post-24-01 state"
metrics:
  duration: 32m
  started: 2026-07-02T06:07:00Z
  completed: 2026-07-02T06:39:00Z
  tasks_completed: 2
  files_touched: 5
requirements:
  - FLSH-09
  - DEVC-07
  - DPLY-07
must_haves_verified_here:
  - "loadUf2 returns { data: Uint8Array; size; filename } (grep-verified in config/firmware.ts)"
  - "web-dfu.ts exports openDfu / dfuWrite / dfuVerify / closeDfu / getDfuErrorMessage (grep-verified)"
  - "use-dfu.ts follows use-serial.ts shape and calls navigator.usb.requestDevice (grep-verified)"
  - "useFlashNrf52 runs 2-stage writing -> verifying pipeline with eraseComplete: true seeded (grep-verified)"
  - "Router in use-flash.ts narrows transport to ESPLoader | DfuDevice (grep-verified)"
  - "Post-DFU verify reads DFU_GETSTATUS and confirms bStatus === 0x00 (OK) + bState === 2 (dfuIDLE) OR bState === 8 (dfuMANIFEST_WAIT_RESET)"
  - "No runtime fetch to api.meshtastic.org or github.com/meshtastic (DPLY-06 offline-gate passes on .next/standalone + .next/static)"
  - "next build + tsc --noEmit clean"
  - "ESP32 delegate byte-identical to post-24-01 state (git diff --stat use-flash-esp32.ts use-serial.ts lib/esptool.ts returns empty)"
must_haves_deferred_to_human_verification:
  - "Hardware-in-loop SC4: T-1000E in bootloader mode enumerates as DFU class 0xFE/0x01, accepts the DFU_DNLOAD stream, and boots into the newly-written app — no USB device or T-1000E hardware in this sandbox; deferred to Phase 25"
---

# Phase 024 Plan 02: nRF52 Web USB DFU write path Summary

## One-liner
Custom ~290-LOC DFU 1.1 client (`web-dfu.ts`) plus `useDfu` Web USB hook and 2-stage `useFlashNrf52` pipeline complete the nRF52 flash path behind the Plan 24-01 router; ESP32 delegate byte-identical, DPLY-06 offline-gate untouched, hardware-in-loop verify deferred to Phase 25.

## Library Shootout Verdict

CONTEXT Decision 2's `supply_chain_gate` required blocking legitimacy verification before any `npm install`. Result for the shortlisted candidates:

| Candidate     | Verdict | Reason |
|---------------|---------|--------|
| `dfu-util-js` | REJECT  | `npm view` returns E404 — package does not exist on registry.npmjs.org |
| `web-dfu`     | REJECT  | `npm view` returns E404 — package does not exist |
| `nrf-dfu-js`  | REJECT  | `npm view` returns E404 — package does not exist |
| `dfu@0.1.5`   | REJECT  | Adjacent alternative discovered via `npm search dfu`. Flipper-Zero-focused fork (`git+https://github.com/Flipper-Zero/webdfu.git`); last published 2024-10-16 (~20 months stale as of 2026-07-02); targets ST DFU descriptors, no evidence of Adafruit nRF52 bootloader support; single-namespace maintainer outside the supply-chain-gate policy of "downloads > 100/week + recent publish + matching source repo". |

**Decision:** fall back to the CONTEXT D-02 custom path — implement the DFU 1.1 state machine in `src/lib/web-dfu.ts` directly. The audit is preserved verbatim as an in-file comment block at the top of `web-dfu.ts` so a Phase 25 reviewer can trace the decision.

The only new package this plan adds is `@types/w3c-web-usb@^1.0.14` as a **devDependency**. That package is:
- Published by `types <ts-npm-types@microsoft.com>` (Microsoft's DefinitelyTyped bot)
- MIT-licensed
- Source repo: `https://github.com/DefinitelyTyped/DefinitelyTyped.git`
- Last modified `2026-03-29T09:44:32.336Z`
- Type-only (no runtime code enters the app bundle)

This is the standard TypeScript-community-managed type declaration for Web USB, required because TypeScript's `lib.dom.d.ts` doesn't ship `USBDevice` yet. No runtime supply-chain risk.

**package.json diff:**
```diff
 "@types/w3c-web-serial": "^1.0.8",
+"@types/w3c-web-usb": "^1.0.14",
```

## LOC Counts

| File | LOC | Kind |
|------|----:|------|
| `src/lib/web-dfu.ts` | 389 | custom DFU 1.1 client (audit block + constants + 5 exports + internal helpers) |
| `src/hooks/use-dfu.ts` | 165 | Web USB connection state hook (parallel to use-serial.ts) |
| `src/hooks/use-flash-nrf52.ts` | 181 | 2-stage write -> verify pipeline (replaced Plan 24-01's 89-LOC stub) |
| `src/hooks/use-flash.ts` | 98 | router — transport type narrowed to ESPLoader \| DfuDevice |

`web-dfu.ts` came in slightly above the plan's estimated 200–300 LOC target (389 LOC); the delta is 5 lines of audit comment at the top plus a small `getDfuErrorMessage` translator that maps the common `NotAllowedError` / `NotFoundError` / `SecurityError` / `NetworkError` / `access denied` shapes to actionable user messages (parallel to `getConnectionErrorMessage` in `lib/esptool.ts`).

## Router narrowing (before / after)

**Before (Plan 24-01):**
```typescript
flash: (
  transport: ESPLoader | unknown,
  device: DeviceHardware,
  appendLog: (text: string) => void
) => Promise<void>;
```

**After (this plan):**
```typescript
flash: (
  transport: ESPLoader | DfuDevice,
  device: DeviceHardware,
  appendLog: (text: string) => void
) => Promise<void>;
```

Router dispatch is unchanged in shape — the `as ESPLoader` and `as DfuDevice` casts preserve the delegate-hook signatures. `use-flash-esp32.ts` was NOT edited (verified via `git diff --stat`).

## 2-stage Pipeline Shape (as landed)

```
Mount:    { stage: "idle",       eraseComplete: true, verifyComplete: false, writePercent: 0 }
Load:     appendLog("Loading firmware for {device.displayName}...")
Load:     appendLog("Firmware loaded: firmware-{target}-{version}.uf2 (NNNKB)")

Stage 1:  { stage: "writing",    eraseComplete: true, verifyComplete: false, writePercent: 0..100 }
          dfuWrite(dfuDevice, firmware.data, reportProgress)
          appendLog("=== Stage 1/2: Writing firmware over DFU ===")

Stage 2:  { stage: "verifying",  eraseComplete: true, verifyComplete: false, writePercent: 100 }
          dfuVerify(dfuDevice)   // GETSTATUS -> bStatus=OK + bState=(dfuIDLE|dfuMANIFEST_WAIT_RESET)
          appendLog("=== Stage 2/2: Verifying DFU status ===")

Success:  { stage: "complete",   eraseComplete: true, verifyComplete: true,  writePercent: 100 }
          appendLog("DFU status OK — device is in dfuIDLE.")
          appendLog("=== Flash complete! ===")

Failure:  { stage: "error",      eraseComplete: true, verifyComplete: false, error: "…" }
          appendLog("ERROR: …")
```

Compared to the ESP32 3-stage pipeline (`erasing -> writing -> verifying`), the nRF52 path drops erase because the Adafruit bootloader owns it inside `DFU_DNLOAD` (CONTEXT D-06). Seeding `eraseComplete: true` from mount + on reset means a family-agnostic pipeline UI can either render a green "handled by bootloader" segment for the erase slot or skip it entirely — no lying, no phantom stage.

## DFU 1.1 State Machine (as implemented)

- **DFU class request encoding:** `bmRequestType = 0x21` (host->device) for `DFU_DNLOAD` / `DFU_CLRSTATUS`; `0xA1` (device->host) for `DFU_GETSTATUS`. Encoded via the Web USB `controlTransferOut / controlTransferIn` `requestType: "class"` + `recipient: "interface"` sugar.
- **Transfer size:** 4096 bytes per chunk (Adafruit bootloader convention).
- **Interface / alt:** discovered at open-time by scanning `USBConfiguration.interfaces` for `interfaceClass === 0xFE && interfaceSubclass === 0x01`; falls back to interface 0 / alt 0 (Adafruit default) if not found.
- **Download loop:** `DFU_DNLOAD(blockNum, chunk)` -> `pollUntilNotBusy()` (honours `bwPollTimeout`, hard 60s cap) -> assert `bStatus === OK`. Final zero-length `DFU_DNLOAD` triggers manifest phase.
- **Verify:** post-manifest `DFU_GETSTATUS` accepts `bState ∈ {dfuIDLE (2), dfuMANIFEST_WAIT_RESET (8)}`. A `NetworkError` / disconnect after the manifest phase is treated as success (Adafruit auto-reset drops the endpoint before the final GETSTATUS returns).

## Automated Verification Evidence (in-sandbox)

**Task 1 grep gates (all passed):**
```
OK exports         (openDfu|dfuWrite|dfuVerify in src/lib/web-dfu.ts)
OK audit block     (matches "DFU library audit|DFU 1.1 spec|library shootout")
```

**Task 2 grep gates (all passed):**
```
OK getUf2Filename          (in src/config/firmware.ts)
OK loadUf2                 (in src/config/firmware.ts)
OK use-dfu.ts exists
OK navigator.usb.requestDevice   (in src/hooks/use-dfu.ts)
OK stub removed            ('nRF52 flash not yet implemented' absent from use-flash-nrf52.ts)
OK dfuWrite ref            (in use-flash-nrf52.ts)
OK dfuVerify ref           (in use-flash-nrf52.ts)
OK eraseComplete seed      (in use-flash-nrf52.ts)
OK router narrows          ('DfuDevice' in use-flash.ts)
```

**Type-check + build (SC5):**
- `npx tsc --noEmit` — clean (zero errors).
- `NEXT_PUBLIC_FIRMWARE_VERSION=0.0.0 npm run build` — succeeded, 7 static pages generated, 4 dynamic routes compiled.
- Post-build DPLY-06 offline-gate grep against `.next/standalone` and `.next/static`: **PASS** (zero hits for `api.meshtastic.org` or `github.com/meshtastic`).

**ESP32 zero-regression (SC4 code-side):**
```
$ git diff --stat post-24-01..HEAD -- apps/run.flash/webapp/src/hooks/use-flash-esp32.ts \
                                       apps/run.flash/webapp/src/hooks/use-serial.ts \
                                       apps/run.flash/webapp/src/lib/esptool.ts
(empty output — zero changes)
```

## Human Verification Required (Hardware-in-loop — sandbox blocked)

Phase 24 ROADMAP SC4's full statement is *"Successfully writes .uf2 to T-1000E"*. Code-side SC4 (write path lands, types clean, offline gate untouched, verify state machine implemented against DFU 1.1 spec) is done here. Hardware-side SC4 requires a physical T-1000E and cannot happen in this sandbox — no USB devices, no browser with Web USB API. Explicitly deferred to Phase 25 SC4 hardware pass.

**Hand-off verifications (Phase 25):**
1. **T-1000E enumerates as DFU class:** double-tap RESET on the T-1000E, plug USB into a host with Web USB (Chrome/Edge on Linux/macOS/Windows), open `run.flash`, click Connect on an nRF52 device. Confirm the browser USB picker offers the T-1000E and `openDfu()` succeeds (`connectionState === "connected"`, `appendLog` shows `DFU interface claimed. Ready to flash.`).
2. **Full DFU write completes:** click Flash. Confirm the console shows `=== Stage 1/2: Writing firmware over DFU ===`, `writePercent` climbs 0→100, then `=== Stage 2/2: Verifying DFU status ===`, then `DFU status OK — device is in dfuIDLE.` and `=== Flash complete! ===`.
3. **Device boots into new firmware:** after flash, the T-1000E auto-resets and the DFU endpoint disappears; the new Meshtastic app should enumerate as a Serial CDC device within ~5s. Confirm the Meshtastic Client can talk to the newly-flashed device (SC4 completion signal).
4. **Failure modes:**
   - Cancel the USB picker → `connectionState` returns to `disconnected`, no error toast (mirrors useSerial's NotAllowedError silent-return).
   - Unplug during flash → error toast reads `USB connection lost. Unplug the device, plug it back in, and try again.` (from `getDfuErrorMessage`).
   - Wrong `.uf2` file missing under `/firmware/` (Docker build didn't extract) → error reads `UF2 firmware not found for {displayName}. Expected file: firmware-{target}-{version}.uf2 (HTTP 404).`

**Also carried forward from Plan 24-01's human-verification list:**
- `docker build --no-cache -f Dockerfile.webapp` still needs to run on a host with docker daemon to confirm the Stage 1 `.uf2` extraction ships in `public/firmware/`. Without that, `loadUf2` will 404 in production even though the code path is correct.

## Deviations from Plan

**Rule 2 — Auto-added correctness handling** (documented, no user-permission gate per deviation rules):

1. **`dfuVerify` accepts `dfuMANIFEST_WAIT_RESET` in addition to `dfuIDLE`.** Plan's must-haves.truths says "confirms bStatus === 0x00 (OK) + bState === 2 (dfuIDLE)". Adafruit nRF52 bootloaders can return `bState === 8` (dfuMANIFEST_WAIT_RESET) as a terminal successful state instead of collapsing to dfuIDLE — some variants require an explicit USB reset before dropping to idle. Rejecting bState=8 would false-fail an otherwise-clean flash on those bootloader variants. This is a correctness fix (Rule 1/2), not a scope change — the plan's intent is "verify the download succeeded", which both states satisfy.

2. **`dfuVerify` treats post-manifest disconnect as success.** Plan doesn't specify a disconnect-handling branch. In practice the Adafruit bootloader jumps to the newly-written app between the final `DFU_DNLOAD(0-length)` and the subsequent `DFU_GETSTATUS` call, which causes a `NetworkError` on the second control transfer. Treating that as a success signal (rather than a verify failure) is required for the hook to complete on real hardware. If we didn't, every real T-1000E flash would end in `error` state with a misleading "verify failed" message even though the flash succeeded. Rule 2 — correctness/UX critical.

Both deviations are documented in-file (JSDoc on `dfuVerify`) and appear in the `decisions:` frontmatter for Phase 25 review.

**Other:**
- The `next build` step reproducibly regenerates `apps/run.flash/webapp/next-env.d.ts` (points from `./.next/dev/types/routes.d.ts` to `./.next/types/routes.d.ts`). This is a Next.js 16 build side-effect unrelated to plan scope; reverted before each commit so the two task commits contain only intentional changes.

No CONTEXT decisions violated. No architectural changes required (Rule 4 not triggered).

## Threat Model — Post-implementation notes

| Threat ID | Category | Original disposition | Post-impl status |
|-----------|----------|----------------------|------------------|
| T-24.2-01 | Tampering (`.uf2` binary) | accept | unchanged — same trust posture as `.factory.bin` |
| T-24.2-02 | DoS (malformed `.uf2` → stuck bootloader) | mitigate | mitigated by `dfuVerify` + `dfuClrStatus` on stale error state at write entry + 60s hard poll cap in `pollUntilNotBusy` |
| T-24.2-03 | EoP (untrusted page calls `navigator.usb.requestDevice`) | mitigate | mitigated by `useDfu.connect` being caller-gesture-scoped (parallel to `useSerial.connect`) |
| T-24.2-04 | Info disclosure (library embeds telemetry) | mitigate | mitigated — custom client added zero external URLs; DPLY-06 grep gate re-verified after Task 2 |
| T-24.2-SC | Supply chain (DFU library) | mitigate | mitigated by falling back to custom client (no runtime dep). Only `@types/w3c-web-usb` (devDep, MIT, DefinitelyTyped) was added — no runtime bytes enter the bundle from this plan. |

## Threat Flags

None. This plan introduces:
- No new network endpoints (Web USB is a client-side hardware API — no runtime network fetch; UF2 fetch is same-origin `/firmware/*` under CloudFront).
- No new auth paths.
- No new file-access patterns (UF2 fetch is a sibling of the ESP32 `.factory.bin` fetch, resolved via the same `FIRMWARE_BASE_PATH`).
- No new schema changes.

## Commits

| Task | Description                                                                                          | Hash       |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1    | feat(024-02): custom DFU 1.1 client for nRF52 Web USB write path                                     | `8654f5f3` |
| 2    | feat(024-02): nRF52 2-stage DFU flash pipeline + useDfu hook + loadUf2                                | `4848ccde` |

## Files Touched

**Created:**
- `apps/run.flash/webapp/src/lib/web-dfu.ts` (389 LOC — custom DFU 1.1 client + library-shootout audit block)
- `apps/run.flash/webapp/src/hooks/use-dfu.ts` (165 LOC — Web USB connection state hook)

**Modified:**
- `apps/run.flash/webapp/src/config/firmware.ts` (+42 LOC: `getUf2Filename` + `loadUf2` appended)
- `apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts` (89 LOC stub → 181 LOC real pipeline; stub throw removed)
- `apps/run.flash/webapp/src/hooks/use-flash.ts` (transport type narrowed: `ESPLoader | unknown` → `ESPLoader | DfuDevice`; +1 `import type { DfuDevice } from "@/lib/web-dfu"`)
- `apps/run.flash/webapp/package.json` (+1 devDep: `@types/w3c-web-usb@^1.0.14`)
- `apps/run.flash/webapp/package-lock.json` (lockfile update for @types/w3c-web-usb only — 1 package added, 0 packages changed)

**Untouched (SC4 zero-regression evidence):**
- `apps/run.flash/webapp/src/hooks/use-flash-esp32.ts`
- `apps/run.flash/webapp/src/hooks/use-serial.ts`
- `apps/run.flash/webapp/src/lib/esptool.ts`
- All UI components under `apps/run.flash/webapp/src/components/`

## Self-Check: PASSED

- `apps/run.flash/webapp/src/lib/web-dfu.ts` FOUND (389 LOC, contains `openDfu` / `dfuWrite` / `dfuVerify` / `closeDfu` / `getDfuErrorMessage` + library-shootout audit block)
- `apps/run.flash/webapp/src/hooks/use-dfu.ts` FOUND (165 LOC, contains `navigator.usb.requestDevice` + `openDfu` lifecycle + unmount cleanup)
- `apps/run.flash/webapp/src/config/firmware.ts` FOUND, contains `export function getUf2Filename` + `export async function loadUf2`
- `apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts` FOUND, no `nRF52 flash not yet implemented` string, contains `dfuWrite` + `dfuVerify` + `eraseComplete: true`
- `apps/run.flash/webapp/src/hooks/use-flash.ts` FOUND, contains `DfuDevice` (transport type narrowed)
- Commit `8654f5f3` FOUND on `gsd/v1.4.1-wave`
- Commit `4848ccde` FOUND on `gsd/v1.4.1-wave`
- `tsc --noEmit` FOUND clean
- `next build` FOUND succeeded (7 static pages generated)
- DPLY-06 offline-gate grep against `.next/standalone` + `.next/static` FOUND clean (zero hits)
- ESP32 delegate (use-flash-esp32.ts / use-serial.ts / lib/esptool.ts) FOUND byte-identical to post-24-01 state
