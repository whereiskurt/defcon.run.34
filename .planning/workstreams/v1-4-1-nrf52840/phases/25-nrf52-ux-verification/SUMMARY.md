# SUMMARY — Phase 25 nRF52 UX + verification

**Workstream:** v1-4-1-nrf52840
**Phase:** 25 — nRF52 UX + verification
**Status:** Code-side complete (SC1-3). Hardware SCs (SC4, SC5, DFU failure-modes) remain routed to STATE.md > Blockers per CONTEXT.md.

## Plans

| Plan | Description | Tasks | Merged |
|------|-------------|-------|--------|
| 25-01 | Family-aware transport plumbing + Connect step | 4/4 | PR #232 (2026-07-02) |
| 25-02 | BootloaderHelp + ChipMismatch family variants + FlashStep + slug reconcile | 4/4 | Pending PR |

Total: 8/8 tasks, 8 commits.

## Plan 25-02 commit ledger

| Task | Commit | Description |
|------|--------|-------------|
| 25-02-1 | `a10836b6` | BootloaderHelp family-aware variant (ESP32 kept byte-identical; nRF52 body covers double-tap RESET + Adafruit UF2 volume + DFU-class device enumeration hints) |
| 25-02-2 | `e20f3576` | ChipMismatchWarning nRF52 VID/PID copy (optional `detectedVidPid`; family-aware `categoryMessage` in connect-step) |
| 25-02-3 | `39b25fc9` | FlashStep DfuDevice/ESPLoader union (discriminated `FlashTransport`; `chipInfo` optional; family-aware pre-flash identity line + recovery `<ol>` bootloader step; wizard-container branch-render on `family`) |
| 25-02-4 | `be984ae1` | Slug reconcile `SEEED_TRACKER_T1000_E` → `TRACKER_T1000_E` + Phase 25 gate |

## Success Criteria — coverage

| SC | Status | Evidence |
|----|--------|----------|
| SC1 BootloaderHelp family-aware variant | Code-verified | 25-02-1 commit; ESP32 body byte-identical |
| SC2 ChipMismatchWarning nRF52 coverage | Code-verified | 25-02-2 commit; VID/PID surface renders when `detectedVidPid` set |
| SC3 Connect-error categories DFU coverage | Code-verified | Plan 25-01-3 + 25-02-2 (family-aware categoryMessage) |
| SC4 T-1000E end-to-end flash | Blocker (hardware) | Routed to STATE.md > Blockers per CONTEXT.md |
| SC5 Recommended ESP32 no-regression | Blocker (hardware) | Routed to STATE.md > Blockers; byte-identical guards satisfied at grep level |

## Verification (phase-level)

- `tsc --noEmit` — clean at every task boundary
- `next build` — clean at Plan 25-02 close (`NEXT_PUBLIC_FIRMWARE_VERSION=2.7.26` sandbox stand-in for the Dockerfile-injected value; production build path injects via ARG per next.config.ts)
- `grep -r 'SEEED_TRACKER' apps/run.flash/webapp/src/` — 0 hits
- `grep -r 'TRACKER_T1000_E' apps/run.flash/webapp/src/` — 1 hit (the reconciled TODO)
- `grep 'Try Connect once' bootloader-help.tsx` — 1 hit (ESP32 branch preserved)
- Files NOT touched (Phase 24 lockdown per PATTERNS.md): `use-serial.ts`, `use-dfu.ts`, `use-flash*.ts`, `web-dfu.ts`, `Dockerfile.webapp` — 0 changes

## Deviations from PLAN.md

Two targeted extensions consistent with plan intent:

- **Plan 25-02-2 (categoryMessage family-awareness)** — plan said "Extend `categoryMessage` in connect-step where appropriate." Applied: added family arg with nRF52-side wording swaps ("DFU interface" instead of "serial port"; double-tap RESET hint on `no-response`; nRF52-specific generic fallback). ESP32 branch strings unchanged.
- **Plan 25-02-3 (wizard-container FlashStep gate)** — original render was `{selectedDevice && serial.chipInfo && (<FlashStep …/>)}`. Since nRF52 has no `chipInfo`, the render is now family-branched: nRF52 gates on `dfu.isConnected` + wires `dfu.consoleLogs / dfu.appendLog / dfu.disconnect`; ESP32 branch keeps its `serial.chipInfo` gate + serial wiring byte-identical.

## Blockers — still routed to STATE.md

- **SC4** T-1000E DFU write end-to-end (hardware-in-the-loop; requires Kurt's physical T-1000E + Chrome/Edge Web USB)
- **SC5** Recommended ESP32 positive-control regression (hardware-in-the-loop)
- **Web-USB-DFU failure-mode spot-checks** (bootloader-not-attached, mid-write disconnect) — hardware-in-the-loop

## Files changed (Plan 25-02)

- `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx` — family-aware variant
- `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx` — optional `detectedVidPid` for nRF52 VID/PID surface
- `apps/run.flash/webapp/src/components/connect/connect-step.tsx` — propagate `family` to BootloaderHelp; `categoryMessage` family-aware
- `apps/run.flash/webapp/src/components/flash/flash-step.tsx` — discriminated `FlashTransport`; optional `chipInfo`; family-aware pre-flash + recovery copy
- `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` — build `flashTransport`; branch FlashStep render on family
- `apps/run.flash/webapp/src/config/devices.ts` — slug TODO reconcile
