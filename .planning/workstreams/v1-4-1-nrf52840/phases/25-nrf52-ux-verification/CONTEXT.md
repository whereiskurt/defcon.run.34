# Phase 25 CONTEXT — nRF52 UX + verification

**Workstream:** v1-4-1-nrf52840
**Depends on:** Phase 24 (merged in PR #229) — device-family flash router, custom DFU 1.1 client, Dockerfile nrf52840 admit
**Requirements:** BRND-03, FLSH-10

## Goal

Wire the nRF52 flash path all the way to the wizard UI: the Connect step must accept the DFU transport for nRF52 devices, the Flash step must accept the `DfuDevice`, and the two brand-critical UX components (bootloader-help, chip-mismatch) must speak nRF52 in addition to ESP32. Users flashing a T-1000E get the right "double-tap RST" copy, the four connect-error categories still fit the DFU path, and the residual v1.4 slug-nomenclature TODO closes.

Phase 24 shipped: `useFlash` is a router, `useFlashNrf52` + `useDfu` + `web-dfu.ts` exist, Dockerfile Stage 1 admits nrf52840 and extracts `.uf2` artifacts. Docker + image-inspect blockers verified 2026-07-02 against real Meshtastic 2.7.26.

Not shipped in Phase 24 (discovered here, scoped into Phase 25):
- `wizard-container.tsx` still spawns `useSerial` only — no `useDfu` call
- `ConnectStep` prop shape only accepts a `SerialState`
- `FlashStep` prop shape only accepts an `espLoaderRef`

Those wiring pieces are part of Phase 25 Plan 25-01/25-02.

## Success Criteria

1. **BootloaderHelp:** family-aware variant. ESP32 keeps the current BOOT+RST copy; nRF52 shows double-tap-RST + a note that the T-1000E enumerates as an Adafruit bootloader mass-storage device / DFU class.
2. **ChipMismatchWarning:** copy covers both `esp32*` and `nrf52840`. Where the detected chip and expected architecture are named, the copy handles both families (nrf52840 detection via USB VID/PID rather than esptool's chip name).
3. **Connect-error categories:** four classes (`cancelled` silent, `in-use`, `no-response`, `generic`) re-validated against the Web-USB-DFU flow. `classifyConnectError` gains DFU error-string patterns; the DFU path's `NotAllowedError` already routes silently in `useDfu`, mirroring `useSerial`.
4. **HARDWARE (Blocker — stays):** T-1000E flashes cleanly and joins the mesh after unplug/replug. Requires Kurt's physical T-1000E + Chrome/Edge Web USB.
5. **HARDWARE (Blocker — stays):** at least one Recommended ESP32 still flashes with no copy or UX regression from the router split + ConnectStep transport-agnostic refactor.

## Files to Touch

**Components (UX):**
- `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx` — accept `family` prop, branch nRF52 variant.
- `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx` — extend copy for nRF52 (VID/PID surface instead of chip name for DFU path).
- `apps/run.flash/webapp/src/components/connect/connect-step.tsx` — accept discriminated `{family:"esp32", serial} | {family:"nrf52", dfu}` transport prop; classify + surface DFU errors; forward `family` to BootloaderHelp.
- `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` — spawn `useDfu` alongside `useSerial`; select transport by `getDeviceFamily(selectedDevice)`; forward to ConnectStep + FlashStep.
- `apps/run.flash/webapp/src/components/flash/flash-step.tsx` — accept `dfuDeviceRef` XOR `espLoaderRef`; pass through to `useFlash.flash()` (which already routes by family).

**Config / types:**
- `apps/run.flash/webapp/src/config/devices.ts:23` — reconcile TODO. `hardware-list.json` uses `TRACKER_T1000_E` (verified via docker image inspect 2026-07-02); the TODO should reference the same slug.

**No new hooks or lib files.** All new work is UI wiring on top of Phase 24 primitives.

## What STAYS a Blocker

- **SC4** — T-1000E DFU write end-to-end. Sandbox has no physical hardware or browser with Web USB access.
- **SC5** — Recommended ESP32 positive-control regression. Same reason — physical hw required.
- **Web-USB-DFU failure-mode spot-checks** (bootloader-not-attached, mid-write disconnect) — real hw only.

These MUST remain listed in STATE.md > Blockers when Phase 25 hits verify; do NOT falsely green them. Code-side SCs 1-3 are all that can be exercised in the sandbox.

## Locked Decisions

1. **ConnectStep prop shape:** discriminated union `{ family: "esp32"; serial } | { family: "nrf52"; dfu }` — NOT two mutually-exclusive optional props. Fail-fast on family mismatch.
2. **Family propagation:** derived once in `WizardContainer` via `getDeviceFamily(selectedDevice)`, passed down; never re-derived in leaf components.
3. **BootloaderHelp:** single component with a `family` prop that switches its inner copy — not two separate components. Accordion shell stays identical for UX consistency.
4. **ChipMismatch DFU surface:** for nRF52, show USB VID/PID hex in the "detected" position instead of a chip name (DFU class doesn't expose an esptool-style chip identifier). Function signature grows an optional `detectedVidPid?: string` prop.
5. **Slug reconcile:** the canonical slug is `TRACKER_T1000_E` per Meshtastic hardware-list.json (verified 2026-07-02 in docker Stage 1 output). Update the TODO comment string; no code path uses `SEEED_TRACKER_T1000_E`.

## Verification

- `tsc --noEmit` clean
- `next build` clean
- No new runtime calls to `api.meshtastic.org` or `github.com/meshtastic`
- Snapshot check: BootloaderHelp rendered for family="esp32" ≡ current committed copy (regression guard for SC5)
- Manual browser walkthrough not possible in sandbox; screenshot / dev-server exercise deferred to Kurt for SC4/SC5.
