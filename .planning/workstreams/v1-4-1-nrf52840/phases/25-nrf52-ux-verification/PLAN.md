# PLAN — Phase 25 nRF52 UX + verification

**Workstream:** v1-4-1-nrf52840
**Phase:** 25 — nRF52 UX + verification
**Plans:** 2 (both code-side; hardware SCs 4+5 stay routed to blockers)

Two atomic plans, commit-per-task. Total 8 tasks. All work is UI wiring on top of Phase 24 primitives — no new hooks, no new lib files.

---

## Plan 25-01 — Family-aware transport plumbing + Connect step

**Goal:** After this plan, `wizard-container.tsx` selects the transport by device family, `ConnectStep` accepts and renders the DFU state as first-class as the serial state, and connect-error classification covers the DFU error strings.

**Files:**
- `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx`
- `apps/run.flash/webapp/src/components/connect/connect-step.tsx`

**Requirements:** BRND-03 (UX), FLSH-10 (nRF52 flash flow — connect side)

**Tasks:**

1. **25-01-01 — Wire `useDfu` into wizard-container; select transport by family.**
   Add `const dfu = useDfu();` alongside `useSerial`. Derive `family = selectedDevice ? getDeviceFamily(selectedDevice) : null`. Pass `{family, serial, dfu}` shape into ConnectStep + FlashStep (typed as a discriminated union in the props). Reset both transports in `resetWizard`. Keep both hooks alive across renders (React rules-of-hooks; same convention `useFlash` uses).
   Verify: `tsc --noEmit` clean; no runtime pull of `useDfu` behind a conditional; wizard renders unchanged for esp32 devices (byte-identical `serial` handling on the esp32 branch).

2. **25-01-02 — ConnectStep: discriminated transport prop + DFU render path.**
   Rewrite `ConnectStepProps` to accept `transport: {family:"esp32"; serial: SerialState} | {family:"nrf52"; dfu: DfuState}`. Keep the existing ESP32 JSX byte-identical (regression guard for SC5). Add the parallel nRF52 render branch that reads `dfu.connectionState / dfu.error / dfu.isConnected` and calls `dfu.connect()` from the Connect button. `chipMismatch` prop becomes optional (nRF52 has no chip name to compare).
   Verify: grep `Try Connect once` still present (ESP32 copy regression guard); `tsc --noEmit` clean; render of `<ConnectStep transport={{family:"esp32",...}} ...>` unchanged from pre-refactor.

3. **25-01-03 — `classifyConnectError` extension for DFU strings.**
   In `connect-step.tsx`, extend the existing `classifyConnectError` switch to include DFU error patterns: `transferOut failed`, `transferIn failed`, `device disconnected`, `SecurityError`, `not opened`, `not claimed`. Fold into existing categories (`in-use` for SecurityError/access, `no-response` for transferOut/transferIn/disconnected, `generic` fallback). Do NOT create a parallel classifier — the shape is family-agnostic.
   Verify: unit test the classifier with three synthetic DFU error strings → correct category; `tsc --noEmit` clean.

4. **25-01-04 — Snapshot & sanity gate.**
   Run `next build` + `tsc --noEmit` + grep for accidental changes to `use-serial.ts` / `use-dfu.ts` / `use-flash*.ts` / `web-dfu.ts` (must be empty). Add commit body noting what was NOT touched.
   Verify: build passes; no unrelated file changes.

---

## Plan 25-02 — BootloaderHelp + ChipMismatch family variants + FlashStep + slug reconcile

**Goal:** After this plan, users flashing a T-1000E get the correct bootloader-help copy (double-tap RST + Adafruit UF2 hint), the chip-mismatch panel handles nRF52 detection (VID/PID surface), FlashStep accepts the DFU device, and the residual v1.4.1 slug TODO closes.

**Files:**
- `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx`
- `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx`
- `apps/run.flash/webapp/src/components/connect/connect-step.tsx` (propagate `family` prop to BootloaderHelp)
- `apps/run.flash/webapp/src/components/flash/flash-step.tsx`
- `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` (pass transport ref to FlashStep)
- `apps/run.flash/webapp/src/config/devices.ts` (line 23 TODO comment)

**Requirements:** BRND-03, FLSH-10

**Tasks:**

1. **25-02-01 — BootloaderHelp: family-aware variant.**
   Add `family: DeviceFamily` prop. ESP32 branch: current copy byte-identical (regression guard — grep for "Try Connect once" and "BOOT" survive). nRF52 branch: 4-5 step `<ol>` covering: 1) data-USB cable check, 2) close other apps, 3) T-1000E enters bootloader via double-tap RESET (NOT hold BOOT), 4) confirm the device appears as an Adafruit UF2 mass-storage volume + a DFU-class USB device before Connect, 5) different USB port / cable if stuck. Link to Meshtastic nRF52 flashing docs. Wire `family` prop through ConnectStep (Plan 25-01 already added `family` to ConnectStep's transport prop).
   Verify: snapshot equivalence for `family="esp32"` render; `tsc --noEmit` clean.

2. **25-02-02 — ChipMismatchWarning: extend copy for nRF52.**
   Add optional `detectedVidPid?: string` prop. When present (nRF52 path), render VID/PID hex in place of the chip name; extend the intro paragraph to name the check as "USB device family" not "chip". Extend `categoryMessage` in connect-step where appropriate. For the ESP32 path, current props + copy stay byte-identical.
   Verify: `tsc --noEmit` clean; grep confirms ESP32 copy unchanged.

3. **25-02-03 — FlashStep: accept DfuDevice XOR ESPLoader.**
   Widen the `flashState.flash` type to the router shape `(transport: ESPLoader | DfuDevice, device, appendLog) => Promise<void>` (already the exported shape from `use-flash.ts`). Add a discriminated `transport: {family:"esp32", espLoaderRef} | {family:"nrf52", dfuDeviceRef}` prop. `handleFlash` picks the right ref by family. `chipInfo` prop becomes optional (nRF52 has no chip). Pre-flash panel replaces the ESP32-only chip line with a family-aware line when nRF52 (show VID/PID). Update `wizard-container` FlashStep call site to pass the family-branched transport ref.
   Verify: `tsc --noEmit` clean; `next build` clean; ESP32 pre-flash panel copy byte-identical (grep for the current chip-line format).

4. **25-02-04 — Slug reconcile + Phase 25 gate.**
   Update `apps/run.flash/webapp/src/config/devices.ts:23` TODO comment: change `SEEED_TRACKER_T1000_E` → `TRACKER_T1000_E` (canonical per Meshtastic hardware-list.json, verified via docker image inspect 2026-07-02 in Phase 24 STATE). Run `next build` + `tsc --noEmit`; grep for `SEEED_TRACKER` anywhere in `src/` (must return empty). Add commit body summarizing which SCs are code-verified and which stay blockered.
   Verify: build passes; grep empty; STATE-side blocker list unchanged (SC4, SC5, DFU failure-mode remain routed to Blockers).

---

## Verification (Phase-level)

- `tsc --noEmit` clean across both plans
- `next build` clean at the end of Plan 25-02
- Grep guards: `"Try Connect once"` still present in bootloader-help.tsx; `SEEED_TRACKER` absent from `src/`; no changes to `use-serial.ts` / `use-dfu.ts` / `use-flash*.ts` / `web-dfu.ts` / `Dockerfile.webapp`
- No new runtime calls to `api.meshtastic.org` or `github.com/meshtastic`

## Blockers (stay routed to STATE.md > Blockers — NOT in the plan)

- **SC4** T-1000E DFU write end-to-end (hardware-in-loop; Kurt)
- **SC5** Recommended ESP32 positive-control regression (hardware-in-loop; Kurt)
- **Web-USB-DFU failure-mode spot-checks** (bootloader-not-attached, mid-write disconnect) — hardware-in-loop; Kurt

## Effort estimate

- Plan 25-01: ~150 LOC touched, 4 commits, ~30 min
- Plan 25-02: ~180 LOC touched, 4 commits, ~40 min
- Total 8 commits; both plans single-file-heavy; no cross-file surprises
