---
gsd_state_version: 1.0
workstream: v1-4-1-nrf52840
milestone: v1.4.1
milestone_name: nRF52840 / T-1000E Flash Support
status: Phase 25 code-side complete (#232 + #234 merged); hardware verification remains with Kurt
stopped_at: All 8 code-side SCs verified (SC1-3); 3 hardware-in-loop items (SC4, SC5, DFU failure modes) awaiting Kurt's T-1000E + ESP32 + Web USB browser
last_updated: "2026-07-02T12:52:00.000Z"
last_activity: 2026-07-02 — PR #234 merged; Phase 25 code-side done; ruleset bypass working end-to-end for autonomous merge
progress:
  total_phases: 2
  completed_phases: 2
  total_plans: 4
  completed_plans: 4
  percent: 100
---

# v1.4.1 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.5** — touches only `apps/run.flash/webapp/` + `apps/run.flash/webapp/Dockerfile.webapp`.

## Current Position

Phase: 25 - nRF52 UX + verification (code-side complete)
Plan: — (all 4 plans across Phase 24 + 25 merged)
Status: v1.4.1 code side is DONE. Milestone completion gated on Kurt's hardware verification of the 3 hardware-in-loop items below.
Last activity: 2026-07-02 — PR #234 merged (Plan 25-02 BootloaderHelp + ChipMismatch + FlashStep + slug reconcile); Phase 25 SUMMARY.md landed; 8/8 code-side SCs verified across Phase 24 + 25.

## Merged PRs

| Phase / Plan | PR | Merged |
|---|---|---|
| Phase 24 (device-family router + nRF52 flash path) | #229 | 2026-07-02 12:03 UTC |
| Phase 25 planning (2 plans / 8 tasks) | #231 | 2026-07-02 12:22 UTC |
| Plan 25-01 (family-aware transport plumbing) | #232 | 2026-07-02 12:37 UTC (autonomous, ruleset bypass) |
| Plan 25-02 (UX variants + FlashStep + slug reconcile) | #234 | 2026-07-02 12:51 UTC (autonomous, ruleset bypass) |

## Phase 24 Blockers

### Verified via sandbox docker (2026-07-02, unblocked)

- ~~[NETWORK+DOCKER]: Real `docker build` against current Meshtastic stable~~ — ✅ `docker build --target firmware -t dc34-run-flash-fw-only:test webapp/` clean; resolved Meshtastic stable `2.7.26.54e0d8d` from api.meshtastic.org, downloaded all 5 firmware zips including `firmware-nrf52840-2.7.26.54e0d8d.zip`.
- ~~[IMAGE-INSPECT]: Post-build verification of image contents~~ — ✅ `/hardware/hardware-list.json` contains `{hwModelSlug: TRACKER_T1000_E, architecture: nrf52840, displayName: "Seeed Card Tracker T1000-E"}`; 30 nrf52840 entries; 77 `.factory.bin` + 10+ `.uf2` artifacts extracted (canaryone, heltec-mesh-node-t114 etc.). Confirms the Dockerfile.webapp Phase 24 changes (jq filter, download loop, unzip step) work end-to-end.

### Remaining hardware-in-loop (need Kurt's hw + browser)

- [v1.4.1 / Phase 25 — HARDWARE-IN-LOOP]: T-1000E DFU write end-to-end. Requires physical T-1000E + Chrome/Edge Web USB.
- [v1.4.1 / Phase 25 — HARDWARE-IN-LOOP]: Web USB DFU failure-mode spot-checks (bootloader-not-attached, mid-write disconnect) on real hw.
- [v1.4.1 / Phase 25 — HARDWARE-IN-LOOP]: Positive-control regression on at least one Recommended ESP32 (proves router split didn't break the esptool-js path).

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
