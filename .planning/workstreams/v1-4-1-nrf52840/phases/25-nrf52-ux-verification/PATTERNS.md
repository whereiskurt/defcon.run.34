# PATTERNS.md — Phase 25 nRF52 UX + verification

Maps each Phase 25 planned change to the closest existing structure, so implementation follows conventions instead of inventing them.

## New/changed files and their analogs

| Planned change | Closest existing pattern | Notes |
|---|---|---|
| **BootloaderHelp** — add `family` prop, branch on ESP32 vs nRF52 copy | Current `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx` (Accordion shell, Meshtastic doc link, `<ol>` step list) | Keep the Accordion wrapper + external link; swap the `<ol>` contents based on family. No new UI primitives. |
| **ChipMismatchWarning** — extend copy for nRF52 (VID/PID surface) | Current `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx` (Card + AlertTriangle + two-paragraph body) | Add optional `detectedVidPid` prop. When `family="nrf52"`, render `detectedVidPid` in place of `detectedChipName`. Keep Card + AlertTriangle shell. |
| **ConnectStep** transport-agnostic (accept `serial` OR `dfu`) | Current `apps/run.flash/webapp/src/components/connect/connect-step.tsx` (already reads a `SerialState` interface local to the file) | Introduce a discriminated union `TransportState = {family:"esp32", serial:SerialState} | {family:"nrf52", dfu:DfuState}` at file top. Extract state-machine reads through a small `resolve(state)` helper so the JSX doesn't grow a switch per state read. |
| **wizard-container** — spawn `useDfu` alongside `useSerial`, select transport by family | Same file's current use of `useSerial` + `useFlash` (line 29-30) | Add `const dfu = useDfu()` on line 30. Compute `family` from `selectedDevice`. Pass `{family, serial}` or `{family, dfu}` to `ConnectStep` and `FlashStep`. Keep both hooks alive across renders (React rules of hooks — same reason `useFlash` calls both delegate hooks unconditionally). |
| **flash-step** — accept DfuDevice ref XOR ESPLoader ref | Current `apps/run.flash/webapp/src/components/flash/flash-step.tsx` (accepts `espLoaderRef: React.RefObject<ESPLoader \| null>`) | Widen `flashState.flash` to `(transport: ESPLoader \| DfuDevice, ...)` — already the shape in `use-flash.ts` post-Phase 24. Add discriminated `transport: {family:"esp32", espLoaderRef} | {family:"nrf52", dfuDeviceRef}`. Make `chipInfo` optional; for nRF52 it's absent. |
| **classifyConnectError** — extend for DFU strings | Current `classifyConnectError()` in `connect-step.tsx` (Phase 19-02) | Add DFU-side patterns to the existing switch: `"transferOut failed"` → `no-response`, `"NetworkError: the device was disconnected"` → `no-response`, `"SecurityError"` → `in-use` etc. Fold into existing category functions, do NOT create a parallel classifier. |
| **devices.ts:23** slug reconcile | Existing TODO comment references `SEEED_TRACKER_T1000_E`; hardware-list.json (verified via docker image inspect) uses `TRACKER_T1000_E` | One-line comment edit only; no code path uses the wrong slug. |

## Delegate hook shape (reference)

`use-flash.ts` (Phase 24) already accepts the discriminated transport:

```ts
flash: (
  transport: ESPLoader | DfuDevice,
  device: DeviceHardware,
  appendLog: (text: string) => void
) => Promise<void>
```

So the router downstream of `useFlash` needs no changes — only the surfaces that CONSTRUCT the transport (wizard-container) and CONSUME the state (ConnectStep, FlashStep) need widening.

## What NOT to change

- **`use-serial.ts`, `use-dfu.ts`, `use-flash.ts`, `use-flash-esp32.ts`, `use-flash-nrf52.ts`, `web-dfu.ts`** — all Phase 24-shipped; do not touch. Phase 25 only wires UI on top.
- **`use-wizard.ts`, `use-configure.ts`** — orthogonal to the family split.
- **`Dockerfile.webapp`** — Phase 24; already verified via real docker build 2026-07-02.
- **The router's active-family ref logic** — Phase 24 CONTEXT locked it. Do not add a family listener or reactive `active` state.

## Snapshot / regression guard

For SC5 (Recommended ESP32 no-regression), Phase 24 already guaranteed byte-identical `use-flash-esp32.ts`. Phase 25 needs a similar guard for the UI shift: keep the ESP32 branch of BootloaderHelp copy byte-identical to the current file so an accidental ESP32 rewording during nRF52 addition trips CI. Snapshot test not necessary; a targeted grep in the PR body ("`Try Connect once`" still present in bootloader-help.tsx after edits) is enough.
