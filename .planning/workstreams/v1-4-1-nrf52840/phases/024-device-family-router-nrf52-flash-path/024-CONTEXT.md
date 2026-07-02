# Phase 24 CONTEXT — Device-family router + nRF52 flash path

**Workstream:** v1-4-1-nrf52840
**Milestone:** v1.4.1 nRF52840 / T-1000E Flash Support
**Captured:** 2026-07-02 (headless / autonomous)
**Requirements:** DEVC-07, FLSH-09, DPLY-07

## Domain

`apps/run.flash/webapp` gains a device-family router in `use-flash.ts` that dispatches by `deviceHardware.architecture`: existing `esp32*` families keep the current `esptool-js` path bit-for-bit unchanged; `nrf52840` takes a new Web-USB-DFU write path. `Dockerfile.webapp` Stage 1 extends its jq filter and unzip pass so a `firmware-t1000-e-{version}.uf2` ships alongside the ESP32 `.factory.bin` set. Recommended set is preserved (5 ESP32 devices); the T-1000E slug appears in `hardware-list.json` but is NOT promoted to Recommended in this phase — that gate is Phase 25 hardware verify.

## Canonical Refs (MANDATORY reading before planning)

- `.planning/workstreams/v1-4-1-nrf52840/ROADMAP.md` — Phase 24 goal + 5 success criteria
- `.planning/workstreams/v1-4-1-nrf52840/STATE.md` — flags Web USB DFU vs UF2 drop as the open research question
- `.planning/backlog/nrf52840-t1000e-support.md` — scope table (ESP32 vs nRF52 layer-by-layer), plan sketch
- `apps/run.flash/webapp/src/hooks/use-flash.ts` — current ESP32-only flash pipeline (erase → write → verify)
- `apps/run.flash/webapp/src/hooks/use-serial.ts` — current Web Serial transport (parallel structure for the DFU transport hook)
- `apps/run.flash/webapp/src/lib/esptool.ts` — esptool.js wrapper (parallel structure for a `web-dfu.ts` wrapper)
- `apps/run.flash/webapp/src/config/firmware.ts` — `getFactoryFilename` + `loadFirmware` (parallel `getUf2Filename` + `loadUf2` needed)
- `apps/run.flash/webapp/src/config/devices.ts` — `RECOMMENDED_SLUGS`, arch labels, sort/dedupe
- `apps/run.flash/webapp/src/types/device.ts` — `ESP32_ARCHITECTURES`, `isEsp32Device` (extend with `NRF52_ARCHITECTURES` / `getDeviceFamily`)
- `apps/run.flash/webapp/Dockerfile.webapp` — Stage 1 firmware/hardware-list resolution
- `.planning/PROJECT.md` — Zero-runtime-dependency and offline-guarantee guardrails (DPLY-06 grep gate)

## SPEC Lock

No SPEC.md exists for this phase (workstream started 2026-07-02 with ROADMAP-only scoping). ROADMAP.md success criteria (SC1–SC5) are the locked requirements for this phase.

## Decisions (Implementation)

### 1. Router shape — extract-and-dispatch, not inline branch

`useFlash` becomes a thin top-level router hook that inspects `device.architecture` (via a new `getDeviceFamily(device)` helper) and delegates to either `useFlashEsp32` (the current implementation, verbatim) or `useFlashNrf52` (new). Both delegate hooks conform to the same `UseFlashReturn` shape (`progress`, `isFlashing`, `isComplete`, `isError`, `flash`, `reset`). The dispatch signature stays `flash(transport, device, appendLog)` — the *transport* argument becomes a discriminated union (`ESPLoader | DfuDevice`) resolved by the caller from a family-aware `useSerial`/`useDfu` split.

**Why:** SC4 requires ESP32 zero-regression. An inline branch inside `useFlash` risks tangling the two paths (shared state, shared refs, shared error handling). Extracting the ESP32 body verbatim into `useFlashEsp32` freezes the ESP32 flash behaviour by construction — reviewers can eyeball the diff and confirm the ESP32 file is a byte-identical move. It also lets each family evolve independently (nRF52 will likely grow its own progress semantics; see Decision 6).

**How to apply:** Plan N-01 creates the router + `useFlashEsp32` (copy-paste move) + `getDeviceFamily`. Plan N-02 fills in `useFlashNrf52`. `use-serial.ts` gets a parallel `use-dfu.ts` hook that owns `navigator.usb.requestDevice()` + DFU claim/detach; caller composes them via a `useTransport(device)` wrapper (or a family branch in the wizard).

### 2. nRF52 write mechanism — Web USB DFU (library-first, custom fallback)

The nRF52 path uses **Web USB DFU** against the T-1000E's Adafruit-family bootloader. Preference order at plan gate:

1. Adopt an established library (`dfu-util-js`, `web-dfu`, or `nrf-dfu-js` — evaluated in Plan N-02 research). Must be small, tree-shakeable, offline-clean (no runtime CDN or telemetry), and compatible with Adafruit nRF52 bootloader DFU descriptors.
2. If no clean library exists (bundle bloat, license conflict, missing progress hooks), implement a ~300-LOC DFU 1.1 host in `src/lib/web-dfu.ts` (spec is USB DFU 1.1 — `DFU_DNLOAD` + `DFU_GETSTATUS` state machine).

**Explicitly rejected:** File System Access API UF2 drop. Reason — breaks the wizard cadence (user must approve directory + drag file), no programmatic progress, no verify signal on drop completion, degrades to "fire-and-forget" against the roadmap's SC4 completion-report requirement.

**Why:** STATE.md pre-decided the direction ("Web USB DFU is preferred for consistent UX across families"). Locking it here so Plan N-02 opens with the library shootout rather than re-litigating the transport. Library-first prevents the custom-DFU write from becoming a maintenance burden; the fallback exists so a licensing/bundle veto doesn't stall the phase.

**How to apply:** Plan N-02's first task is a 30-minute library audit (`dfu-util-js`, `web-dfu`, `nrf-dfu-js`). If shortlist survives the offline-clean / bundle-size / license check, use it. Otherwise write `src/lib/web-dfu.ts` with a minimal DFU 1.1 client (targeting Adafruit bootloader interface 0, alt setting 0, transferSize 4096).

### 3. Family discriminator — derived from `architecture`, not schema-added

A new pure helper `getDeviceFamily(device: DeviceHardware): "esp32" | "nrf52"` lives in `src/types/device.ts` next to the existing `isEsp32Device`. It reads `device.architecture` and returns the family. Add `NRF52_ARCHITECTURES = ["nrf52840"]` alongside `ESP32_ARCHITECTURES`. No new field on `hardware-list.json`; no schema change.

**Why:** `architecture` is the canonical Meshtastic-supplied source of truth. Adding a `family` field would create a second source that could drift when the Meshtastic API adds new architectures. The current `isEsp32Device` pattern already establishes this idiom — extend it, don't fork it.

**How to apply:** `use-flash.ts` router calls `getDeviceFamily(device)`. `device-picker`, `configure-step`, `connect-step`, `chip-mismatch`, `bootloader-help` all import the same helper when they need to branch on family. Unknown architectures throw at the router boundary (fail-fast, no silent ESP32 fallback that could brick an unknown device).

### 4. UF2 artifact naming + Dockerfile Stage 1 extension

Match ESP32 naming exactly. Stage 1:

1. jq architecture filter — add `or .architecture == "nrf52840"` to the existing select.
2. Add `nrf52840` to the `for ARCH in ...` firmware-download loop.
3. After the `.factory.bin` unzip step, add a parallel `unzip -q -o "/tmp/${ZIP}" "firmware-*.uf2" -d /firmware/` step (`.uf2` files sit alongside `.factory.bin` files in `/firmware`, then all get copied to `public/firmware/` in Stage 2).

`src/config/firmware.ts` gains `getUf2Filename(device, version)` returning `firmware-${platformioTarget}-${version}.uf2` and `loadUf2(device, version)` returning `{ data: Uint8Array; size: number; filename: string }` (Uint8Array, not binary string — DFU write consumes bytes directly).

**Why:** Symmetric naming keeps the vendor scheme predictable — Meshtastic ships both artefact families under the same `firmware-{platformioTarget}-{version}.{factory.bin|uf2}` convention. Symmetric `loadFirmware` / `loadUf2` shape keeps `config/firmware.ts` navigable for a reader who already knows the ESP32 side.

**How to apply:** Plan N-01 owns the Dockerfile change + `getUf2Filename`. Plan N-02 uses `loadUf2` in `useFlashNrf52`. DPLY-06 grep gate is unaffected (still greps `.next/standalone` and `.next/static` for meshtastic hostnames — Docker-layer downloads don't reach those directories).

### 5. Recommended set — freeze at 5 ESP32 devices this phase

`RECOMMENDED_SLUGS` is NOT expanded to include T-1000E in Phase 24. It stays at `{HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, STATION_G2}`. A TODO comment above the set marks T-1000E for promotion once Phase 25 SC4 hardware-in-loop verifies it.

**Why:** Recommended = "we've tested this end-to-end". SC1 says "Recommended set is preserved", not "expanded". Adding T-1000E to Recommended before Phase 25 hardware verify would false-promise the badge and violate the same trust contract v1.0 established. The hardware-in-loop policy in STATE.md is explicit — hardware SCs must be Blockers, not silently marked green — the same discipline applies here: no "Recommended" claim without hardware proof.

**How to apply:** Plan N-01 leaves `RECOMMENDED_SLUGS` untouched. Add a `// TODO(v1.4.1 close-out): promote after Phase 25 SC4 hardware verify` line right above the constant.

### 6. Progress pipeline shape for nRF52 — 2 stages (write + verify), reuse `FlashProgress`

nRF52 DFU has no explicit user-facing erase step — the bootloader handles it as part of `DFU_DNLOAD`. So `useFlashNrf52` writes a 2-stage pipeline: `stage: "writing" → "verifying" → "complete"`. It uses the existing `FlashProgress` type unchanged, but seeds `eraseComplete: true` in the initial state so the pipeline visualisation can either (a) render a green "handled by bootloader" segment for the erase slot, or (b) render only 2 segments when `getDeviceFamily(device) === "nrf52"`. Verify: read `DFU_GETSTATUS` after final `DFU_DNLOAD` block and confirm `bStatus === OK` + `bState === dfuIDLE` — no MD5 for this family.

**Why:** Forcing a 3-stage visual on a 2-stage physical process would either lie (fake erase) or confuse (erase stage that immediately jumps to "done"). Reusing `FlashProgress` avoids a parallel-progress-type explosion — the UI and hooks stay one-shape.

**How to apply:** Plan N-02's `useFlashNrf52` seeds `INITIAL_FLASH_PROGRESS` locally with `eraseComplete: true, stage: "writing"` on first `flash()` call. The pipeline component (`components/flash/*`) gets a `family` prop and either dims/hides or annotates the erase segment. If UX polish for that pipeline component slips, defer to Phase 25 — the router + write path are the phase-24 must-haves.

## Deferred / Later

- **T-1000E → Recommended promotion** — Phase 25 close-out, gated on SC4 hardware verify.
- **Additional nRF52 slugs beyond T-1000E** (Adafruit Feather nRF52840, RAK4631 nRF52-variant) — future milestone; hardware-list will surface them once the router lands, but no explicit UX work.
- **iOS/Android Web USB DFU** — explicitly out of scope per backlog doc.
- **OTA / erase flow for nRF52** — out of scope; rely on bootloader default state.
- **`tlora-t3s3 → dio` positive-control flash** — v1.4 leftover; opportunistic during Phase 25 hardware pass.

## Non-goals for this phase

- Reworking the wizard step sequence — Pick → Connect → Flash → Configure → Done stays intact; family branching happens *inside* Connect and Flash, not at the wizard level.
- Refactoring `configure-step` — MQTT/channel/identity config push runs on `@meshtastic/core` which speaks Meshtastic protocol over Web Serial. The T-1000E post-flash configure path is Phase 25's problem (or a Phase 25 spike, if the nRF52 Meshtastic build exposes a Web Serial CDC endpoint we can reuse).
- Chip-mismatch copy update — Phase 25 scope (BRND-03).
- Bootloader-help copy variants — Phase 25 scope (BRND-03).

## Constraints

- **DPLY-06 offline gate** — no `api.meshtastic.org` or `github.com/meshtastic` in `.next/standalone` or `.next/static`. Any DFU library must ship its firmware descriptors inline; runtime firmware fetches must resolve to `/firmware/*` served from CloudFront.
- **Zero regression on ESP32** (SC4) — enforced by extract-and-move-not-rewrite in Decision 1.
- **`next build` + `tsc --noEmit` clean** (SC5) — new hooks must be strictly typed; DFU library must ship types or a shim.
- **Bundle size** — Web USB DFU library candidates < 50 KB gzipped preferred; hard veto > 150 KB gzipped.
- **No hardware in this sandbox** — SC4's "successfully writes .uf2 to T-1000E" cannot be validated here; it must be flagged as a Phase 24 → Phase 25 hand-off blocker in STATE.md when Phase 24 code lands.

## Expected plans

- **Plan 24-01 — router + Dockerfile Stage 1 extend + hardware-list surfaces T-1000E**
  - `getDeviceFamily` + `NRF52_ARCHITECTURES` in `types/device.ts`
  - Extract current `useFlash` body into `useFlashEsp32` (verbatim), rewire `useFlash` as router
  - Dockerfile Stage 1: jq filter + `for ARCH` loop adds `nrf52840`, `.uf2` unzip
  - `hardware-list.json` regenerated to include T-1000E slug (verify DPLY-06 gate still passes)
  - SC1, SC2, SC3, SC5 targeted
- **Plan 24-02 — Web USB DFU write path**
  - Library shootout (`dfu-util-js` vs `web-dfu` vs `nrf-dfu-js`) or custom `web-dfu.ts`
  - `use-dfu.ts` hook (parallel to `use-serial.ts`)
  - `useFlashNrf52` — 2-stage progress, DFU write, DFU status verify
  - `loadUf2` + `getUf2Filename` in `config/firmware.ts`
  - SC4 (code-side) + SC5 targeted; hardware-side SC4 is Phase 25's problem

---
*Written headless / autonomously on 2026-07-02. No user in the loop for this discussion — decisions represent the best call given ROADMAP.md, STATE.md, the backlog scope table, and a codebase scout of `use-flash.ts` / `use-serial.ts` / `lib/esptool.ts` / `config/firmware.ts` / `types/device.ts` / `Dockerfile.webapp`.*
