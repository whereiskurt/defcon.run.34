---
gsd_state_version: 1.0
workstream: v1-4-1-nrf52840
milestone: v1.4.1
milestone_name: nRF52840 / T-1000E Flash Support
status: Phase 24 verified (human_needed) — PR pending; ready to plan Phase 25
stopped_at: Phase 24 verify complete; 5/5 code SCs green, 3 hw+docker items routed to blockers
last_updated: "2026-07-02T06:20:00.000Z"
last_activity: 2026-07-02 — Phase 24 verify=human_needed; auto-parser bug required manual executor+verifier spawn
progress:
  total_phases: 2
  completed_phases: 0
  total_plans: 2
  completed_plans: 2
  percent: 50
---

# v1.4.1 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.5** — touches only `apps/run.flash/webapp/` + `apps/run.flash/webapp/Dockerfile.webapp`.

## Current Position

Phase: 25 - nRF52 UX + verification (not started)
Plan: —
Status: Phase 24 verify=human_needed (5/5 code SCs green); PR pending; ready to plan Phase 25
Last activity: 2026-07-02 — Phase 24 verify complete, hardware+docker gates routed to blockers

## Phase 24 Blockers (all hardware-in-loop or network-required, cannot exercise in sandbox)

- [v1.4.1 / Phase 24 — NETWORK+DOCKER]: Real `docker build --no-cache` against current Meshtastic stable — needs outbound network to api.meshtastic.org + github.com and Docker daemon.
- [v1.4.1 / Phase 24 — IMAGE-INSPECT]: Post-build verification that built image contains T-1000E hardware-list entry + `.uf2` artifact — depends on above.
- [v1.4.1 / Phase 24 — HARDWARE-IN-LOOP]: T-1000E DFU write end-to-end (per Kurt's directive, this must be verified before Phase 25 close). Requires physical T-1000E + Chrome/Edge Web USB.
- [v1.4.1 / Phase 24 — HARDWARE-IN-LOOP]: Web USB DFU failure-mode spot-checks (bootloader-not-attached, mid-write disconnect) on real hw.
- [v1.4.1 / Phase 24 — HARDWARE-IN-LOOP]: Positive-control regression on at least one Recommended ESP32 (proves router split didn't break the esptool-js path).

## Informational (non-blocking)

- Slug nomenclature mismatch: `hardware-list.json` uses `TRACKER_T1000_E`; `devices.ts:23` TODO comment references `SEEED_TRACKER_T1000_E`. Reconcile in Phase 25 close-out (single string; no code-path impact).

## Locked Decisions (Phase 24 CONTEXT.md)

1. **Router shape:** `useFlash` becomes a router; ESP32 body extracted verbatim to `useFlashEsp32`; parallel `useFlashNrf52` added. Both share the `UseFlashReturn` shape.
2. **nRF52 write path:** Web USB DFU, library-first (`dfu-util-js` / `web-dfu` / `nrf-dfu-js` shootout at plan gate) with a custom `web-dfu.ts` DFU 1.1 client as fallback. UF2 drop rejected.
3. **Family discriminator:** `getDeviceFamily(device)` in `types/device.ts`, derived from `architecture` (no schema change).
4. **UF2 artifact:** `firmware-${platformioTarget}-${version}.uf2`, symmetric with `.factory.bin`. Stage 1 adds `nrf52840` to jq filter + download loop + parallel `.uf2` unzip step.
5. **Recommended set:** unchanged (5 ESP32 slugs). T-1000E promotion gated on Phase 25 hardware verify.
6. **nRF52 progress pipeline:** 2 stages (write + verify). Reuse `FlashProgress` type; seed `eraseComplete: true`. Pipeline UI branches on family.

## Accumulated Context

### Baseline

Post-v1.4 shipped. `esptool-js ^0.6.0` in place. `use-flash.ts` currently ESP32-only, has explicit `tlora-t3s3 → 'dio'` override at lines 104-106. Dockerfile Stage 1 filter admits only `esp32*` architectures. Dockerfile Stage 1 extracts only `.factory.bin`.

### Blockers/Concerns

- [Phase 24 — RESEARCH]: Web USB DFU vs File System Access API UF2 drop — pick during plan gate. Web USB DFU is more programmatic (proper DFU protocol); UF2 drop requires user gesture + directory picker. Web USB DFU is preferred for consistent UX across families.
- [Phase 25 — HARDWARE-IN-LOOP]: T-1000E boot verification + Recommended ESP32 regression cannot run in this sandbox.

### Deferred / Related

- The tlora-t3s3 flashMode 'dio' hardware verification from v1.4 remains open. Not blocking for v1.4.1 but worth a positive-control flash during Phase 25 if the tlora-t3s3 becomes available.
