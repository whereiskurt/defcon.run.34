# Roadmap: v1.4.1 nRF52840 / T-1000E Flash Support

**Workstream:** v1-4-1-nrf52840
**Parallel-safe with:** v1.5 Bib Registration (zero file overlap — this touches only `apps/run.flash/` + `Dockerfile.webapp`)
**Created:** 2026-07-02
**Base branch:** main (post-v1.4 shipped)

## Milestone Goal

flash.defcon.run supports flashing nRF52840-based Meshtastic devices — starting with the Seeed T1000-E SenseCap Card Tracker — alongside the existing ESP32 family. ESP32 flow is unchanged (positive-control regression on Recommended ESP32).

## Why Not a Fast Follow to v1.4

nRF52840 uses UF2 / Web-USB-DFU, not `esptool-js`. Needs a new device-family router in `use-flash.ts`, a new UF2 extract stage in `Dockerfile.webapp`, and a new bootloader-help UX ("double-tap RST"). See `.planning/backlog/nrf52840-t1000e-support.md` for the scope table.

## Phases

- [ ] **Phase 24: Device-family router + nRF52 flash path** (2 plans expected)
- [ ] **Phase 25: nRF52 UX + verification** (1-2 plans expected)

---

## Phase 24: Device-family router + nRF52 flash path

**Goal:** `apps/run.flash/webapp` flashes an nRF52840 device (Seeed T1000-E) end-to-end via UF2/Web-USB-DFU alongside the existing ESP32 esptool-js path — with a single device-family router that routes by `deviceHardware.architecture`.

**Depends on:** Phase 19 (bumped `esptool-js` 0.6.0 baseline; router lives on the same code path)
**Requirements:** DEVC-07, FLSH-09, DPLY-07

**Success Criteria:**

1. `Dockerfile.webapp` Stage 1 jq filter admits `nrf52840` alongside `esp32*` architectures; hardware-list contains the T-1000E slug + Recommended set is preserved.
2. `Dockerfile.webapp` Stage 1 extracts `firmware-t1000-e-{version}.uf2` alongside the ESP32 `.factory.bin` set; both artifact families ship in the same image; DPLY-06 grep gate still passes.
3. `use-flash.ts` has a family discriminator on `deviceHardware.architecture` — ESP32 family → existing esptool-js path (unchanged); `nrf52840` → new UF2/DFU write path.
4. UF2/DFU path successfully writes the `.uf2` to a T-1000E in bootloader mode and reports completion; ESP32 path has zero regression against the Phase 19 Recommended set.
5. `next build` + `tsc --noEmit` clean; no runtime calls to `api.meshtastic.org` or `github.com/meshtastic` under the new path.

**Expected plans:** router + Dockerfile extract; Web-USB-DFU write path

---

## Phase 25: nRF52 UX + verification

**Goal:** Users flashing a T-1000E get the correct bootloader-help copy ("double-tap RST"), the four connect-error categories still fit, chip-mismatch surfaces nRF families, and one T-1000E is verified flashed end-to-end on hardware.

**Depends on:** Phase 24
**Requirements:** BRND-03, FLSH-10

**Success Criteria:**

1. `bootloader-help.tsx` shows a device-family-aware variant — ESP32 keeps BOOT+RST; nRF52 shows double-tap RST + mass-storage / DFU device-name hint.
2. `chip-mismatch.tsx` copy covers both `esp32*` families and `nrf52840` (naming both detected and expected sides).
3. Four connect-error categories (`cancelled` silent, `in-use`, `no-response`, `generic`) re-validated against the Web-USB-DFU flow.
4. **Hardware-in-loop:** one T-1000E flashes cleanly and joins the mesh after unplug/replug.
5. **Hardware-in-loop:** at least one Recommended ESP32 still flashes with no copy or UX regression from the router split.

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 24. Device-family router + nRF52 flash path | 0/TBD | Ready to plan | - |
| 25. nRF52 UX + verification | 0/TBD | Planned | - |

## Hardware-in-loop policy (per Kurt)

Hardware SCs 4+5 of Phase 25 MUST be flagged in STATE.md > Blockers rather than falsely marked green. This sandbox cannot exercise UF2 writes against a physical T-1000E.
