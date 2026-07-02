---
gsd_state_version: 1.0
workstream: v1-4-1-nrf52840
milestone: v1.4.1
milestone_name: nRF52840 / T-1000E Flash Support
status: Ready to plan Phase 24
stopped_at: Workstream bootstrapped 2026-07-02
last_updated: "2026-07-02T04:15:00.000Z"
last_activity: 2026-07-02 — workstream created, ROADMAP scoped for Phases 24-25
progress:
  total_phases: 2
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# v1.4.1 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.5** — touches only `apps/run.flash/webapp/` + `apps/run.flash/webapp/Dockerfile.webapp`.

## Current Position

Phase: 24 - Device-family router + nRF52 flash path (not started)
Plan: —
Status: Ready to plan Phase 24
Last activity: 2026-07-02 — workstream bootstrapped

## Accumulated Context

### Baseline

Post-v1.4 shipped. `esptool-js ^0.6.0` in place. `use-flash.ts` currently ESP32-only, has explicit `tlora-t3s3 → 'dio'` override at lines 104-106. Dockerfile Stage 1 filter admits only `esp32*` architectures. Dockerfile Stage 1 extracts only `.factory.bin`.

### Blockers/Concerns

- [Phase 24 — RESEARCH]: Web USB DFU vs File System Access API UF2 drop — pick during plan gate. Web USB DFU is more programmatic (proper DFU protocol); UF2 drop requires user gesture + directory picker. Web USB DFU is preferred for consistent UX across families.
- [Phase 25 — HARDWARE-IN-LOOP]: T-1000E boot verification + Recommended ESP32 regression cannot run in this sandbox.

### Deferred / Related

- The tlora-t3s3 flashMode 'dio' hardware verification from v1.4 remains open. Not blocking for v1.4.1 but worth a positive-control flash during Phase 25 if the tlora-t3s3 becomes available.
