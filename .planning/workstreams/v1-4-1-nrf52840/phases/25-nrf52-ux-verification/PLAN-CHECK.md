# PLAN-CHECK — Phase 25 nRF52 UX + verification

**Verdict:** PASSED

Goal-backward analysis of PLAN.md against Phase 25 goal + SCs from ROADMAP.md.

## Goal coverage

**Roadmap goal:** *Users flashing a T-1000E get the correct bootloader-help copy ("double-tap RST"), the four connect-error categories still fit, chip-mismatch surfaces nRF families, and one T-1000E is verified flashed end-to-end on hardware.*

- Bootloader-help family variant: covered by **25-02-01**.
- Four connect-error categories fit DFU: covered by **25-01-03** (extends `classifyConnectError` with DFU strings).
- Chip-mismatch surfaces nRF families: covered by **25-02-02** (VID/PID surface).
- T-1000E flashed end-to-end on hardware: **STAYS a blocker** — routed to STATE.md > Blockers per Kurt's hardware-in-loop policy.

## SC coverage matrix

| SC | Roadmap statement | Plan task | Status |
|----|-------------------|-----------|--------|
| 1 | BootloaderHelp family-aware (ESP32 BOOT+RST; nRF52 double-tap RST + mass-storage/DFU hint) | 25-02-01 | Covered |
| 2 | ChipMismatch copy covers both esp32* + nrf52840 | 25-02-02 | Covered |
| 3 | Four connect-error categories re-validated on Web-USB-DFU | 25-01-03 | Covered |
| 4 | HARDWARE — T-1000E flashes + joins mesh | — | Blocker (hardware; Kurt) |
| 5 | HARDWARE — Recommended ESP32 no-regression | — | Blocker (hardware; Kurt) |

Hardware SCs 4 + 5 correctly stay OUT of the plan and route to blockers.

## Discovered scope (not in ROADMAP text — surfaced during CONTEXT/PATTERNS analysis)

Phase 24 shipped the flash router but did NOT wire the wizard-container's transport selection. That work is genuinely necessary for the family-aware UX to reach the user — a T-1000E user today would hit a wizard that only spawns `useSerial`, so DFU never runs. The plan captures this as **25-01-01** (wizard-container: spawn useDfu + branch by family) and **25-01-02** (ConnectStep: discriminated transport prop) + **25-02-03** (FlashStep: DFU device ref). Without these, SC1-3 would be dead code — the panels would exist but never render for an nRF52 device.

Verdict: this is properly scoped into Phase 25 rather than deferred to a future phase, since without the wiring the family-aware panels are literally unreachable.

## Atomicity + commit-per-task

- Plan 25-01: 4 tasks, each self-contained (wiring, ConnectStep refactor, classifier extension, gate).
- Plan 25-02: 4 tasks, each self-contained (BootloaderHelp, ChipMismatch, FlashStep, slug reconcile + gate).
- Each task has a single-verb goal + verify step + file-list. No task is a compound "and also".

## Risk / dependency review

- **Regression risk on ESP32 path (mitigates SC5):** all 4 ConnectStep + FlashStep + BootloaderHelp changes preserve the ESP32 branch byte-identical, enforced by grep guards ("Try Connect once", chip-line format, "BOOT"). If those grep guards fail post-task, that's a self-detecting regression.
- **No cross-plan dependency loops:** Plan 25-02 depends on Plan 25-01 (BootloaderHelp needs the `family` prop wired through ConnectStep in Plan 25-01), and this is correctly linear.
- **No touch to Phase 24-shipped hooks/lib:** PATTERNS.md explicitly forbids editing `use-serial.ts`, `use-dfu.ts`, `use-flash*.ts`, `web-dfu.ts`, `Dockerfile.webapp`. Plan tasks respect this.

## What could go wrong post-execute

- **Discriminated-union destructuring in JSX** — TypeScript might complain about narrowing across a render callback. Mitigation: `resolve(state)` helper in ConnectStep, mentioned in PATTERNS.md, moves the narrow into a plain function call.
- **useDfu unmount cleanup** — when wizard resets after ESP32 flash, calling `dfu.disconnect()` on an idle DFU state should be a no-op (Phase 24's `disconnect()` already handles this — see `use-dfu.ts:74-86`).

## Verdict

**PASSED.** Two plans, 8 tasks, all code-side SCs covered, hardware SCs correctly routed to Blockers, ESP32 no-regression guarded by grep-level assertions, no touch to Phase 24-shipped primitives. Ready to execute.
