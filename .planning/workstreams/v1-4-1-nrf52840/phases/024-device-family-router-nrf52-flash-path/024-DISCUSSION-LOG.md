# Phase 24 DISCUSSION-LOG — headless / autonomous

**Session:** 2026-07-02 (headless mode, no user in loop)
**Mode:** `--auto` (implicit — headless override; all decisions made autonomously)

## Gray Areas Considered

Six implementation gray areas were surfaced from ROADMAP.md SCs + backlog scope table + a codebase scout of `use-flash.ts`, `use-serial.ts`, `lib/esptool.ts`, `config/firmware.ts`, `types/device.ts`, and `Dockerfile.webapp`.

### 1. Router shape — inline branch vs extract-and-dispatch vs strategy pattern

| Option | Pros | Cons |
|---|---|---|
| A: Inline family branch inside `useFlash` | Smallest diff | Tangles ESP32 & nRF52 state, ref, error handling — high SC4 regression risk |
| **B: Extract `useFlashEsp32` verbatim + parallel `useFlashNrf52` + top-level router** | ESP32 body is a byte-identical move; each family evolves independently; matches likely `useSerial` / `useDfu` split | Two hook files instead of one |
| C: `FlashStrategy` interface + per-device strategy | Most extensible | Overkill for 2 families; premature abstraction |

**Selected:** B. Rationale in CONTEXT.md Decision 1.

### 2. nRF52 write mechanism — Web USB DFU library vs custom DFU vs UF2 drop

| Option | Pros | Cons |
|---|---|---|
| **A: Established Web USB DFU library (`dfu-util-js` / `web-dfu` / `nrf-dfu-js`)** | Programmatic progress + verify; consistent wizard UX; low maintenance | Library-quality risk (offline-clean? bundle size? license?) |
| B: Custom Web USB DFU 1.1 client (~300 LOC in `src/lib/web-dfu.ts`) | Full control; spec is well-defined | Maintenance burden; another attack surface |
| C: File System Access API UF2 drop | Simplest write path | Breaks wizard cadence; no programmatic progress; violates SC4 completion-report requirement |

**Selected:** A with B as fallback. C rejected outright. STATE.md pre-flagged this — Web USB DFU is the preferred direction.

### 3. Family discriminator — derived vs schema field vs static map

| Option | Pros | Cons |
|---|---|---|
| **A: `getDeviceFamily(device)` helper reading `architecture`** | Extends existing `isEsp32Device` idiom; canonical single source of truth (Meshtastic API) | None material |
| B: New `family` field on `hardware-list.json` | Explicit | Schema drift risk when Meshtastic adds new architectures |
| C: Static `FAMILY_BY_ARCH` map in new `family.ts` | Explicit + typed | Redundant with A |

**Selected:** A. Rationale in CONTEXT.md Decision 3.

### 4. UF2 artifact naming + Stage 1 extraction

Only one option makes sense — match the ESP32 convention exactly (`firmware-${platformioTarget}-${version}.uf2`) and add a parallel `unzip -q -o "/tmp/${ZIP}" "firmware-*.uf2"` step alongside the existing `.factory.bin` unzip. Alternatives (custom naming, separate directory) create asymmetry with no offsetting benefit.

**Selected:** Symmetric naming, parallel unzip step. Rationale in CONTEXT.md Decision 4.

### 5. RECOMMENDED_SLUGS — freeze vs expand to include T-1000E

| Option | Pros | Cons |
|---|---|---|
| **A: Freeze at 5 ESP32 devices; TODO for post-Phase-25 promotion** | Recommended = "hardware-verified"; preserves trust contract | T-1000E not badged Recommended in Phase 24 |
| B: Add T-1000E to Recommended in Phase 24 | Symmetric UX | False-promises the badge before hardware verify |

**Selected:** A. Same discipline as the STATE.md hardware-in-loop policy — no green light without hardware proof.

### 6. Progress pipeline shape for nRF52 — 3 stages vs 2 stages

| Option | Pros | Cons |
|---|---|---|
| A: Force 3 stages (fake or instant erase) | UI symmetry with ESP32 | Lies about the physical process; confuses users |
| **B: 2 stages (write + verify), reuse `FlashProgress` type, seed `eraseComplete: true`** | Honest; single progress type; family-conditional UI segment | Requires small pipeline-component tweak |

**Selected:** B. Rationale in CONTEXT.md Decision 6.

## Deferred to Later Phases

- **T-1000E → Recommended promotion** → Phase 25 close-out (post-hardware-verify)
- **Chip-mismatch nRF copy + bootloader-help variant** → Phase 25 (BRND-03)
- **Additional nRF52 slugs** → future milestone
- **iOS/Android Web USB DFU** → out of scope (per backlog)
- **nRF52 post-flash configure path** → Phase 25 (or spike, if `@meshtastic/core` needs work)
- **`tlora-t3s3 → dio` positive-control** → opportunistic during Phase 25 hardware pass

## Claude's Discretion — no user available

- Assumed T-1000E's Adafruit-family nRF52840 bootloader supports Web USB DFU. This is standard for Adafruit-derived bootloaders (used by Feather nRF52840 and confirmed via SenseCAP docs referenced in the backlog scope table); confirm at Plan N-02 hardware landing.
- Chose "library-first, custom fallback" for the DFU write mechanism instead of committing to one path outright — the plan gate is the right place for the library shootout given the offline-clean / bundle-size / license unknowns.
- Chose to hold `RECOMMENDED_SLUGS` at the current 5 rather than pre-badge T-1000E. Kurt's STATE.md hardware-in-loop policy makes clear that hardware-gated claims must be treated as blockers, not green lights — the Recommended badge is a hardware-gated claim.

---
*Log written headless on 2026-07-02. No AskUserQuestion invocations were made — all decisions autonomous.*
