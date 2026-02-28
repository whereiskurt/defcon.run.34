# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** A participant can go from unboxed ESP32 to fully provisioned DCR34 mesh radio in a single browser session, with zero manual configuration steps.
**Current focus:** Phase 2: Flash Engine

## Current Position

Phase: 2 of 4 (Flash Engine)
Plan: 1 of 3 in current phase
Status: Ready
Last activity: 2026-02-28 -- Completed 01-02 (Browser Gate, Wizard, Device Picker)

Progress: [####░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 5.5min
- Total execution time: 0.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-app-scaffold-device-picker | 2 | 11min | 5.5min |

**Recent Trend:**
- Last 5 plans: 6min, 5min
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 4-phase structure derived from requirement clusters -- scaffold/picker, flash, config+API, deployment
- [Roadmap]: SRVR requirements grouped with CONF (Phase 3) because config push depends on server API for secrets
- [Research]: Serial port handoff between flash (esptool.js) and configure (@meshtastic/core) is highest technical risk -- Phase 2/3 boundary
- [01-01]: No service claim check for flash app -- all authenticated DCR34 users can access the flasher
- [01-01]: Omitted mapboxPublicToken from flash auth claims -- not needed for firmware flasher
- [01-01]: Added matrix-green accent and cyber-border CSS for hacker/cyberpunk aesthetic
- [01-02]: Used !important Tailwind modifiers for selected card border to override glass-card:hover
- [01-02]: Vendored hardware-list.json and device SVGs statically rather than runtime fetch
- [01-02]: Deduplication by hwModel to avoid showing multiple platformioTarget variants

### Pending Todos

None yet.

### Blockers/Concerns

- Serial port handoff between Phase 2 (flash) and Phase 3 (configure) requires careful port release/reopen choreography
- Exact Meshtastic firmware version to pin is an event decision, not yet made
- Hardware-specific quirks (CH340 drivers, ESP32-C3 USB-JTAG) need testing with actual devices

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 01-02-PLAN.md (Browser Gate, Wizard, Device Picker) -- Phase 1 complete
Resume file: None
