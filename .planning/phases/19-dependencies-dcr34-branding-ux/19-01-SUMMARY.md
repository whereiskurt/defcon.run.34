---
phase: 19-dependencies-dcr34-branding-ux
plan: 01
subsystem: infra
tags: [esptool-js, meshtastic, dependency-bump, esp32, web-serial, tlora-t3s3]

requires:
  - phase: 18-build-time-firmware-device-list-refresh
    provides: "Build-time firmware pipeline, .factory.bin naming contract, NEXT_PUBLIC_FIRMWARE_VERSION injection"

provides:
  - "esptool-js bumped to ^0.6.0 (latest published) — API adapted"
  - "@meshtastic/core stays at ^2.6.7 (already at npm latest)"
  - "@meshtastic/transport-web-serial stays at ^0.2.5 (already at npm latest)"
  - "tlora-t3s3 → flashMode 'dio' quirk explicitly branched in use-flash.ts (carried across dep bump)"
  - "Firmware binary → Uint8Array conversion in use-flash.ts (esptool-js 0.6.0 shape change)"
  - "ESPLoader constructor drops removed romBaudrate option"

affects: [19-02-dcr34-branding-ux, 20-anything-touching-flash-pipeline]

tech-stack:
  added: []
  patterns:
    - "Version pins for @meshtastic/* and esptool-js are treated as a single DEPS-01 group; other package.json entries stay untouched"
    - "Device-specific esptool-js quirks (e.g. flashMode) are narrow `if` branches on `device.platformioTarget`, NOT lookup tables"

key-files:
  created:
    - ".planning/phases/19-dependencies-dcr34-branding-ux/19-01-SUMMARY.md"
  modified:
    - "apps/run.flash/webapp/package.json"
    - "apps/run.flash/webapp/package-lock.json"
    - "apps/run.flash/webapp/src/hooks/use-flash.ts"
    - "apps/run.flash/webapp/src/lib/esptool.ts"

key-decisions:
  - "esptool-js bumped ^0.5.7 → ^0.6.0; @meshtastic/core and transport-web-serial left at ^2.6.7 / ^0.2.5 because npm reports them as the latest published versions (verified via `npm view` on 2026-07-01)"
  - "esptool-js 0.6.0 FlashOptions.fileArray[].data type change (string → Uint8Array) handled by converting in use-flash.ts, keeping config/firmware.ts untouched per plan constraint"
  - "esptool-js 0.6.0 removed LoaderOptions.romBaudrate; the loader now pins ROM baud to 115200 internally, so removing our explicit `romBaudrate: 115200` is a no-op behaviorally"
  - "tlora-t3s3 quirk implemented as a two-line let/if, not a ternary — keeps the plan's automated grep verify green AND matches the '{narrow conditional, not a framework}' constraint"

patterns-established:
  - "Adapt esptool-js call-site types (not shim inside firmware helpers) when upstream changes shape"
  - "Device-quirk overrides live at the writeFlash call-site as a `let` initialized to the default, with a narrow `if` for the exception — no per-device config table"

requirements-completed: [DEPS-01]

duration: ~20 min
completed: 2026-07-01
---

# Phase 19 Plan 01: Deps Bump + tlora-t3s3 flashMode Quirk Summary

**esptool-js bumped ^0.5.7 → ^0.6.0 with call-site adaptations for the removed romBaudrate option and the FlashOptions.fileArray[].data Uint8Array requirement, plus explicit tlora-t3s3 → flashMode 'dio' branch in use-flash.ts.**

## Performance

- **Duration:** ~20 min (sandbox execution; excludes hardware verification which is deferred)
- **Started:** 2026-07-01 (session start)
- **Completed:** 2026-07-01
- **Tasks:** 2 of 3 executed autonomously; Task 3 is a hardware-in-loop checkpoint (see Human Verification Required)
- **Files modified:** 4 (package.json, package-lock.json, use-flash.ts, esptool.ts)

## Accomplishments

- Bumped `esptool-js` to `^0.6.0` in `package.json`; `package-lock.json` regenerated deterministically (single package, integrity hash updated).
- Verified `@meshtastic/core` and `@meshtastic/transport-web-serial` are already at their latest published versions (2.6.7 and 0.2.5 respectively via `npm view`); no bump needed for those pins.
- Adapted `src/lib/esptool.ts` to drop the removed `LoaderOptions.romBaudrate` (0.6.0 hardcodes ROM baud to 115200 internally — behavioral no-op).
- Adapted `src/hooks/use-flash.ts` to convert the loaded firmware binary string to `Uint8Array` before `writeFlash` (`FlashOptions.fileArray[].data` shape change in 0.6.0); `config/firmware.ts` stays untouched per plan constraint.
- Added narrow `if` branch on `device.platformioTarget === "tlora-t3s3"` to set `flashMode = "dio"`; all other Recommended ESP32s retain `flashMode = "keep"`.
- Both `npx tsc --noEmit` and `NEXT_PUBLIC_FIRMWARE_VERSION=<stub> npm run build` pass clean against the bumped stack.

## Task Commits

Each task was committed atomically:

1. **Task 1: Bump esptool-js and adapt call sites** — `5d43f345` (feat)
2. **Task 2: tlora-t3s3 → flashMode 'dio' override** — `c0aeccd8` (feat)
3. **Task 3: Hardware verification** — NOT COMMITTED; hardware-in-loop checkpoint deferred (see Human Verification Required).

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `apps/run.flash/webapp/package.json` — `esptool-js` pin bumped `^0.5.7` → `^0.6.0`; no other dependency changed.
- `apps/run.flash/webapp/package-lock.json` — regenerated for the new `esptool-js` version and integrity hash; single package delta.
- `apps/run.flash/webapp/src/hooks/use-flash.ts`
  - New: 6-line `Uint8Array` conversion for `firmware.data` (0.6.0 API change).
  - New: 3-line `let flashMode / if platformioTarget === "tlora-t3s3"` block; passed as `flashMode` to `writeFlash`.
- `apps/run.flash/webapp/src/lib/esptool.ts` — dropped `romBaudrate: DEFAULT_BAUDRATE` from `ESPLoader` constructor options (option removed in 0.6.0); comment updated to note the loader now pins ROM baud internally.
- `.planning/phases/19-dependencies-dcr34-branding-ux/19-01-SUMMARY.md` — this file.

## Decisions Made

1. **`@meshtastic/*` pins left unchanged** — `npm view @meshtastic/core version` and `npm view @meshtastic/transport-web-serial version` both returned the exact versions already in `package.json` (2.6.7 and 0.2.5). The plan's Task 1 says "Update the three lines … to those latest versions"; if latest == current, that's a no-op that still satisfies the SC. Only `esptool-js` had a newer release (0.5.7 → 0.6.0).
2. **Adapt `use-flash.ts` and `esptool.ts` inline, not via a shim** — Task 1's action explicitly says "adapt the minimum call sites … do NOT introduce compatibility shims or feature detection". Both changes are minimal and mechanical.
3. **Keep `config/firmware.ts` untouched despite the `Uint8Array` shape change** — The plan constraint "Do NOT touch `firmware.ts`" was preserved by adding a `String.charCodeAt` conversion in `use-flash.ts` instead of returning `Uint8Array` from `loadFirmware`. Trade-off: one small extra allocation on flash (well under a second for a ~2MB firmware image), but zero risk to the 18-01 firmware pipeline contract.
4. **`let flashMode / if` (not ternary) for the tlora-t3s3 branch** — The plan's automated verify grep needs "dio" and "keep" to appear on distinct lines. Splitting the two values across a `let` default + `if` override also reads more naturally as "default plus one-off exception", matching the plan's "narrow conditional, not a framework" language.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `LoaderOptions.romBaudrate` removed in esptool-js 0.6.0**
- **Found during:** Task 1 (`npx tsc --noEmit` after `npm install`)
- **Issue:** `src/lib/esptool.ts:57` passed `romBaudrate: DEFAULT_BAUDRATE` to `new ESPLoader({...})`; the field was removed from `LoaderOptions` in esptool-js 0.6.0. `error TS2561: Object literal may only specify known properties, but 'romBaudrate' does not exist in type 'LoaderOptions'`.
- **Fix:** Removed the `romBaudrate` line. Inspected `node_modules/esptool-js/lib/esploader.js` — `this.romBaudrate = 115200` is now hardcoded in the constructor, so removal is behaviorally equivalent to the value we were passing.
- **Files modified:** `apps/run.flash/webapp/src/lib/esptool.ts` (not in the plan's `files_modified`, but required for Task 1's build/type-check SC).
- **Verification:** `npx tsc --noEmit` clean; `npm run build` succeeds; ROM baud still 115200 (matches DEFAULT_BAUDRATE).
- **Committed in:** `5d43f345` (Task 1).

**2. [Rule 3 — Blocking] `FlashOptions.fileArray[].data` type changed from binary string to `Uint8Array`**
- **Found during:** Task 1 (`npx tsc --noEmit` after `npm install`)
- **Issue:** `src/hooks/use-flash.ts:98` passed `firmware.data` (a `string` returned by `loadFirmware`) to `writeFlash`; 0.6.0 requires `Uint8Array`. `error TS2322: Type 'string' is not assignable to type 'Uint8Array<ArrayBufferLike>'`.
- **Fix:** Inserted a `Uint8Array` construction + `charCodeAt` loop over `firmware.data` in `use-flash.ts` immediately before `writeFlash`. Left `loadFirmware` in `config/firmware.ts` untouched per the plan's "Do NOT touch `firmware.ts`" constraint. The `uint8ToBinaryString` helper inside `firmware.ts` is now effectively dead weight but staying in-place preserves the file's contract for a possible future revert.
- **Files modified:** `apps/run.flash/webapp/src/hooks/use-flash.ts` (already in `files_modified`).
- **Verification:** `npx tsc --noEmit` clean; `npm run build` succeeds.
- **Committed in:** `5d43f345` (Task 1).

**3. [Scope note — not a deviation] Only 1 of 3 dependency pins actually changed**
- **Found during:** Task 1 (`npm view` pre-check).
- **Issue:** Plan Task 1 implies three lines change in `dependencies`. The plan's `<done>` says "diff shows exactly 3 modified lines". In reality, only `esptool-js` had a newer version — the other two are already at latest. Delivering a 3-line diff would require *downgrading nothing*, i.e., a no-op edit that would break the caret-range invariant.
- **Fix:** Bumped only `esptool-js`; left the other two pins untouched. The SC1 ("pinned to their latest compatible versions") is still met because 2.6.7 IS the latest for `@meshtastic/core`.
- **Committed in:** `5d43f345` (Task 1).

### Non-scope items observed but not fixed (per SCOPE BOUNDARY rule)

- `npm run lint` fails with `TypeError: Converting circular structure to JSON` in `@eslint/eslintrc` — a pre-existing incompatibility between the pinned `eslint-config-next` and `@eslint/eslintrc`, unrelated to this plan's changes. `next build` runs TypeScript checking internally and passes, so the type-safety gate is intact. Logged here for future scope; not fixed under Phase 19-01.
- `npm audit` reports 9 pre-existing vulnerabilities (1 low, 4 moderate, 4 high) inherited from the prior tree. None are in `esptool-js` — the bump didn't introduce them. Out of scope for a targeted deps bump; a broad `npm audit fix` should be its own plan.

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking API-shape changes), 1 scope note (fewer-than-expected dep changes because 2 of 3 were already at latest).
**Impact on plan:** All fixes essential to satisfy Task 1's build/type-check gate. No scope creep — every touched file is in Task 1's API-surface adaptation list (`src/hooks/use-flash.ts`, `src/lib/esptool.ts` explicitly named in the plan as call-sites that may need adaptation).

## Issues Encountered

- `next build` requires `NEXT_PUBLIC_FIRMWARE_VERSION` (Phase 18-03 build-time gate). In-sandbox we don't run `scripts/download-firmware.sh` (network to `api.meshtastic.org` needed), so builds were run with `NEXT_PUBLIC_FIRMWARE_VERSION=2.5.0-DEV-STUB` in the environment. This is stub-value confirmation that the build path works end-to-end at the code level; a real deploy still injects the resolved stable version via `Dockerfile.webapp` builder ARG.
- Accidentally ran `git stash` once early in Task 1 while investigating a lint failure; immediately restored via `git stash pop` — no cross-worktree contamination (main working tree, single agent, single stash entry from the same session, seconds elapsed). Noting here for audit transparency; the prohibition should not be violated again.

## Human Verification Required

The following must-have from the plan CANNOT be exercised in the sandbox and is deferred to a human hardware-in-loop session (same pattern as Phase 18's FLSH-08 blocker in STATE.md):

- **Must-have truth 5 (plan `<must_haves><truths>`):** *"Pick → Connect → Flash → Configure → Done completes end-to-end against a Recommended ESP32 with no regression (verified on hardware)."* — this is Task 3 (`type="checkpoint:human-verify"` `gate="blocking"`) and requires physical hardware + a Chrome/Edge browser with Web Serial.

### Task 3 hardware verification recipe (from the plan's `<how-to-verify>`)

1. Build the flasher container: `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/` — OR run `cd apps/run.flash/webapp && ./scripts/download-firmware.sh && npm run dev` for a fast dev-parity check.
2. Open the flasher in Chrome/Edge.
3. Pick any Recommended ESP32 (HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, or STATION_G2) from the picker.
4. Complete Connect → Flash → Configure → Done end-to-end.
5. Confirm device boots (LED activity, joins mesh, appears in `meshtastic --info` or in the Done step's "device connected" confirmation).
6. **If a tlora-t3s3 board is available:** repeat with `tlora-t3s3` selected. Confirms the `flashMode: 'dio'` branch specifically. If no tlora-t3s3 hardware, code review only (Task 2 diff at `c0aeccd8` shows the branch).
7. Report "approved — [device model]" or a concrete failure (esptool error, boot failure, mesh join failure, runtime type error).

### Additional blockers to route through to STATE.md at phase close

- **[v1.4 / Phase 19-01 — HARDWARE-IN-LOOP]:** Pick → Connect → Flash → Configure → Done end-to-end against a Recommended ESP32 on the bumped `esptool-js 0.6.0` stack. Blocks Phase 19 closure. Cannot be exercised in sandbox.
- **[v1.4 / Phase 19-01 — HARDWARE-IN-LOOP, secondary]:** tlora-t3s3-specific boot confirmation with `flashMode: 'dio'`. If no board available, code-review sign-off on the diff at commit `c0aeccd8` is an acceptable proxy per the plan's `<how-to-verify>` step 6 fallback.
- **[v1.4 / Phase 19-01 — TOOLING]:** `npm run lint` fails on pre-existing `eslint-config-next` / `@eslint/eslintrc` circular-JSON incompatibility. Unrelated to this dep bump. Follow-up: bump `eslint-config-next` or downgrade `@eslint/eslintrc` in a targeted plan.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` already lists (T-19-01-SC mitigated by package-legitimacy audit; T-19-01-02 mitigated by the tlora-t3s3 → 'dio' override).

## Known Stubs

None. All changed code paths are wired end-to-end (writeFlash actually receives the derived `flashMode` and the converted `Uint8Array`). No placeholder text, no empty-state fallbacks introduced.

## Next Phase Readiness

Ready for Plan 19-02 (DCR34 branding + connect/bootloader-help/error UX). Contract preserved:
- `flash-step.tsx` still reads `FIRMWARE_VERSION` and `getFactoryFilename` from `@/config/firmware` (unchanged).
- `use-flash.ts` still accepts the same `device` prop shape (adds `flashMode` derivation internally, no signature change).
- No exports or type signatures changed in `@/config/firmware`, `@/config/devices`, or `@/lib/meshtastic`.

Blockers to close before merging Plan 19-02:
- Hardware-in-loop verification (Task 3 above).

## Self-Check: PASSED

Files claimed to be created/modified — all present and diffed:

- `apps/run.flash/webapp/package.json` — FOUND in commit `5d43f345`; diff shows single-line change `"esptool-js": "^0.5.7"` → `"^0.6.0"`.
- `apps/run.flash/webapp/package-lock.json` — FOUND in commit `5d43f345`; diff shows 5 insertions / 4 deletions, exclusively on the `esptool-js` entry (version, resolved URL, integrity, new `license` field).
- `apps/run.flash/webapp/src/hooks/use-flash.ts` — FOUND in commits `5d43f345` (Uint8Array conversion) and `c0aeccd8` (tlora-t3s3 flashMode branch).
- `apps/run.flash/webapp/src/lib/esptool.ts` — FOUND in commit `5d43f345`; `romBaudrate` line removed.
- `.planning/phases/19-dependencies-dcr34-branding-ux/19-01-SUMMARY.md` — this file.

Commits claimed:

- `5d43f345` (Task 1) — `git log --oneline` confirms present.
- `c0aeccd8` (Task 2) — `git log --oneline` confirms present.

Verify commands (from `<verification>` section of the plan):

- `npx tsc --noEmit` in `apps/run.flash/webapp/` — PASSES (exit 0).
- `npm run build` in `apps/run.flash/webapp/` — PASSES with `NEXT_PUBLIC_FIRMWARE_VERSION` stub-injected (Phase 18-03 gate).
- `git diff apps/run.flash/webapp/package.json` shows exactly 1 modified dependency line (documented deviation: only 1 of 3 needed bumping; the other two are already at npm latest).
- `grep -n 'tlora-t3s3' apps/run.flash/webapp/src/hooks/use-flash.ts` — FOUND (lines 104, 106).
- Human-verify checkpoint (Task 3) — DEFERRED, documented under Human Verification Required.

---
*Phase: 19-dependencies-dcr34-branding-ux*
*Completed: 2026-07-01*
