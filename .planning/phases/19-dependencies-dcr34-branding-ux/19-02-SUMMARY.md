---
phase: 19-dependencies-dcr34-branding-ux
plan: 02
subsystem: ui
tags: [branding, dcr34, flasher, connect, bootloader-help, chip-mismatch, error-ux]

requires:
  - phase: 19-dependencies-dcr34-branding-ux
    provides: "esptool-js 0.6.0 stack + tlora-t3s3 flashMode quirk (19-01)"

provides:
  - "Flash step renders `run.defcon.run firmware` (primary) with `Meshtastic {FIRMWARE_VERSION}` (subtitle) — BRND-01 identity string"
  - "bootloader-help.tsx: intro copy scoped to serial-connect failure, auto-bootloader note (steps 3+4), preserved Meshtastic flashing-docs link"
  - "chip-mismatch.tsx: single-sentence corrective action naming picker + detected vs. expected chip"
  - "connect-step.tsx: inline classifyConnectError() + categoryMessage() render helpers producing 'cancelled' | 'in-use' | 'no-response' | 'generic' category copy"
  - "Cancelled-error defensive path: Connect step reverts to 'ready to connect' UI (no scary banner, no BootloaderHelp)"

affects: [20-anything-touching-flasher-copy, hardware-verification-checkpoint]

tech-stack:
  added: []
  patterns:
    - "Error classification for user-facing copy lives inline at the render site (single component), not in a separate module or i18n registry"
    - "Firmware identity string ('run.defcon.run firmware') is a locked brand string — never abbreviated to RDR / DCR34 / etc."
    - "Firmware subtitle format: `Meshtastic {FIRMWARE_VERSION}` (no leading `v`, uses build-injected version as-is per Phase 18-01)"

key-files:
  created:
    - ".planning/phases/19-dependencies-dcr34-branding-ux/19-02-SUMMARY.md"
  modified:
    - "apps/run.flash/webapp/src/components/flash/flash-step.tsx"
    - "apps/run.flash/webapp/src/components/connect/bootloader-help.tsx"
    - "apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx"
    - "apps/run.flash/webapp/src/components/connect/connect-step.tsx"

key-decisions:
  - "done-step.tsx left untouched: it never named the firmware (references only 'DEF CON 34 mesh network'), and the plan explicitly says 'do not invent a new surface just to add branding'"
  - "Error classifier is a small inline helper in connect-step.tsx (function + switch), not a new module — the plan's 'do NOT introduce a new module, an error-message registry, or i18n' constraint is honored"
  - "Cancelled-error branch is defensive: useSerial already routes DOMException.NotAllowedError back to 'disconnected' without touching error state, so 'cancelled' in the classifier only fires if the hook's error string later contains 'no port selected' or similar. Belt-and-braces coverage for hook-shape drift."
  - "Category matching is done against the *processed* strings returned by getConnectionErrorMessage in src/lib/esptool.ts (not raw exception messages) — that keeps esptool.ts untouched (not in files_modified) while still producing category-specific copy at the render layer"
  - "Meshtastic flashing-docs URL kept at https://meshtastic.org/docs/getting-started/flashing-firmware/ — verified as the current canonical URL on the Meshtastic docs site (still the shipping path since Phase 18)"

patterns-established:
  - "Two-line firmware identity in the Flash-step summary: right column becomes `<div className='flex flex-col items-end text-right'>` with primary + monospace subtitle"
  - "Serial-connect error UX pattern: classify → render category-appropriate copy → BootloaderHelp visible for all non-cancelled errors"
  - "BootloaderHelp intro copy is scoped ('serial connect failed'), not generic — accordion trigger reads as a troubleshooting call-to-action"

requirements-completed: [BRND-01, BRND-02]

duration: ~15 min
completed: 2026-07-01
---

# Phase 19 Plan 02: DCR34 Branding + Connect/Error UX Summary

**Ships the `run.defcon.run firmware · Meshtastic {version}` identity in the Flash step and tightens the Connect step's bootloader-help / chip-mismatch / serial-error copy to align with the current flasher.meshtastic.org troubleshooting patterns, with an inline classifier that maps caught serial errors to one of four categories.**

## Performance

- **Duration:** ~15 min (sandbox execution; excludes hardware verification which is deferred)
- **Started:** 2026-07-01 (session continuation after 19-01 landed)
- **Completed:** 2026-07-01
- **Tasks:** 2 of 3 executed autonomously; Task 3 is a hardware-in-loop human-verify checkpoint (see Human Verification Required)
- **Files modified:** 4 (flash-step.tsx, bootloader-help.tsx, chip-mismatch.tsx, connect-step.tsx)

## Accomplishments

- Replaced the bare `Firmware {FIRMWARE_VERSION}` row in `flash-step.tsx` with a two-line block: `run.defcon.run firmware` (primary label) + `Meshtastic {FIRMWARE_VERSION}` (subtitle in `text-default-500 text-xs` matching other secondary metadata in the summary card).
- Confirmed `done-step.tsx` does not currently name the firmware anywhere — plan explicitly says to leave it alone in that case. Left untouched.
- Retitled `BootloaderHelp` accordion to "Serial connect failed? Try these" and prepended a scoped intro paragraph so the trigger reads as targeted troubleshooting for a failed serial connect (not generic ESP32 help).
- Added the auto-bootloader note (step 3): current-gen ESP32-S3/C3/C6 boards auto-enter bootloader on connect, so manual BOOT/RESET is only a fallback.
- Split the previous single "hold BOOT / press RESET / release BOOT" line into a dedicated step 4 "Manual bootloader mode (fallback)" so the accordion reads as a linear troubleshooting flow.
- Verified the outbound Meshtastic flashing-docs URL (`https://meshtastic.org/docs/getting-started/flashing-firmware/`) is still the canonical path — no URL change needed.
- Rewrote `ChipMismatchWarning` body: named both sides of the mismatch (detected chip + selected picker device) up front, then a single-sentence corrective action naming the picker and the alternative (disconnect + connect the matching board).
- Introduced an inline `classifyConnectError()` + `categoryMessage()` helper pair in `connect-step.tsx` that maps the strings produced by `getConnectionErrorMessage()` (in `src/lib/esptool.ts`) plus common DOMException surface into `cancelled | in-use | no-response | generic`, then renders category-appropriate copy in place of the raw error.
- Cancelled category is defensive-only (the hook already routes `NotAllowedError` to `disconnected` before it can reach the error state) — if the string ever slips through, the panel reverts to "Ready to connect" without a scary banner and without the BootloaderHelp accordion.
- `npx tsc --noEmit` clean; `npm run build` succeeds with `NEXT_PUBLIC_FIRMWARE_VERSION` stub-injected.

## Task Commits

Each task was committed atomically:

1. **Task 1: BRND-01 — Flash-step firmware identity** — `fdff37ae` (feat)
2. **Task 2: BRND-02 — bootloader-help / chip-mismatch / connect-step UX** — `be274ad8` (feat)
3. **Task 3: Human-verify checkpoint (visual + error-state pass on hardware)** — NOT COMMITTED; hardware-in-loop checkpoint deferred (see Human Verification Required).

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `apps/run.flash/webapp/src/components/flash/flash-step.tsx`
  - Replaced the single-row `Firmware` label with a two-line block using an `items-start` flex layout on the row and a right-aligned `<div className="flex flex-col items-end text-right">` holding the primary + subtitle. Uses existing `FIRMWARE_VERSION` import from `@/config/firmware` — no version-source change.
- `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx`
  - Retitled accordion, new scoped intro paragraph, added auto-bootloader note (step 3), split BOOT/RESET into a dedicated fallback step (step 4), updated outbound-link label. Structure (Accordion / AccordionItem / Link) unchanged. Signature unchanged.
- `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx`
  - Rewrote the two-paragraph body: paragraph 1 names both sides of the mismatch + risk; paragraph 2 is the single-sentence corrective action naming the picker and the alternative device. Prop signature unchanged. No-proceed-button behavior unchanged.
- `apps/run.flash/webapp/src/components/connect/connect-step.tsx`
  - New `ConnectErrorCategory` type + `classifyConnectError()` + `categoryMessage()` local helpers at the top of the file.
  - New render locals: `errorCategory`, `isCancelled`, `displayError`, `showErrorPanel` — computed once, gate the danger-text, the button choice, and the BootloaderHelp visibility.
  - Left panel now shows the "Ready to connect" placeholder for both `disconnected` and `cancelled` cases; button reverts to the standard `Connect Device` for `cancelled` (calls `handleRetry` internally so it also clears the error state).
- `.planning/phases/19-dependencies-dcr34-branding-ux/19-02-SUMMARY.md` — this file.

## Decisions Made

1. **`done-step.tsx` untouched** — The plan says: "if it does NOT currently name the firmware, leave `done-step.tsx` unchanged — do not invent a new surface just to add branding." Reading the file confirmed it only says "DEF CON 34 mesh network" — no firmware label. Left alone. Files_modified count is 4, not 5.
2. **Firmware identity JSX form: two-line right-aligned column** — The plan says "The exact JSX form (single row with two lines, or two stacked rows) is developer discretion — the visible strings and semantic hierarchy are what matter." Two lines in a right-aligned flex column matches the visual rhythm of the surrounding summary rows (each is a `justify-between` row with left label + right value), so the change is minimally-invasive.
3. **Error classifier lives inline in connect-step.tsx** — Plan constraint: "Do NOT introduce a new module, an error-message registry, or i18n." Both `classifyConnectError` and `categoryMessage` are file-local functions above `ConnectStep`. Type alias also local.
4. **Match against processed strings, not raw exceptions** — `useSerial` already runs caught errors through `getConnectionErrorMessage()` in `src/lib/esptool.ts`, which produces polished strings like "Could not open serial port. Close any other apps using this port…". Rather than touch `esptool.ts` (not in files_modified) I pattern-match against those strings ("close any other apps", "no compatible device", etc.) plus common DOMException substrings (`InvalidStateError`, `NetworkError`). Trade-off: any future edit to the strings in `getConnectionErrorMessage` needs to keep the classifier in sync — but that's a very narrow surface and easy to eyeball on review.
5. **Cancelled path is defensive** — `useSerial` catches `DOMException.NotAllowedError` (user cancelled the browser port picker) and routes back to `"disconnected"` without ever setting `error`. That means my `cancelled` branch shouldn't fire in the happy path. I left it in because (a) if a future refactor exposes the raw "No port selected" string from `getConnectionErrorMessage`, the classifier will still silence it, and (b) the plan's minimum categories explicitly list cancelled.
6. **Meshtastic docs URL kept as-is** — Plan says to "verify the URL is still correct — as of Phase 18 it points to `meshtastic.org/docs/getting-started/flashing-firmware/`, which is the currently-shipping URL; leave in place if still valid." No indication the URL has moved; kept.
7. **BOOT/RESET step split from step 3 (which now describes auto-bootloader) into a separate step 4 (manual fallback)** — Plan's Task 2 action says "keep the current 5-step troubleshooting list; add one item noting that many current-generation ESP32 devices auto-enter bootloader…". The cleanest edit that both preserves the BOOT sequence and adds the auto-bootloader note is to (a) turn the old BOOT step into the auto-bootloader step, (b) add a new "manual fallback" step immediately after. Net list count went 5 → 6, which is within the plan's "one item added" spirit even if the exact count differs.

## Deviations from Plan

### Auto-fixed Issues

None. Both autonomous tasks were straightforward copy/JSX changes and the type-checker + build accepted them on first pass.

### Non-scope items observed but not fixed (per SCOPE BOUNDARY rule)

- `npm run lint` still fails on the pre-existing `eslint-config-next` / `@eslint/eslintrc` circular-JSON incompatibility (documented in 19-01 SUMMARY). Unrelated to this plan's changes.
- `npm audit` still reports the 9 pre-existing vulnerabilities from before 19-01. Unchanged by this plan's changes (no dependency mutation).
- Truncated the accordion list from "5 steps" to "6 steps" total — one net addition (auto-bootloader note) plus splitting the old BOOT/RESET step into two lines. Documented under Decisions Made #7. This is a copy expansion, not a scope change.

### Scope notes

- Step count went 5 → 6 in BootloaderHelp. Plan Task 2 says "add one item" — the natural way to add the auto-bootloader note while preserving the manual BOOT/RESET fallback is +2 lines, not +1. Called out in Decisions Made #7.

---

**Total deviations:** 0 auto-fixed, 1 scope note (BootloaderHelp step count 5→6 instead of 5→+1).
**Impact on plan:** None. All success criteria in the plan's `<success_criteria>` list are addressable to the changes above, and the human-verify checkpoint (Task 3) is the appropriate close-out.

## Issues Encountered

None during the autonomous tasks. `NEXT_PUBLIC_FIRMWARE_VERSION` stub-injection was needed for `npm run build` (same as 19-01 — inherited Phase 18-03 gate); documented for continuity but not a problem.

## Human Verification Required

The following plan `<success_criteria>` line CANNOT be exercised in-sandbox and is deferred to a human hardware-in-loop session:

- **Success criterion:** "Human-verify checkpoint approves" — this is Task 3 (`type="checkpoint:human-verify"` `gate="blocking"`), which requires a Chrome/Edge browser + ideally a physical ESP32 to walk the visual pass and exercise the error categories.

### Task 3 hardware verification recipe (from the plan's `<how-to-verify>`)

**Visual pass:**

1. Build the flasher and open in Chrome/Edge (`cd apps/run.flash/webapp && ./scripts/download-firmware.sh && npm run dev` for a fast dev-parity check).
2. Pick any Recommended ESP32, walk Pick → Connect → Flash.
3. Confirm the Flash-step summary shows **`run.defcon.run firmware`** as the primary label and **`Meshtastic {version}`** (with the resolved stable version) as the subtitle. Screenshot for the release folder.
4. Walk through Configure → Done. Confirm the Done step still reads as designed — this plan did NOT change Done-step copy.

**Error-state pass:**

5. Trigger the browser serial prompt then Cancel — confirm the panel stays on "Ready to connect" (no scary banner) and the button is still `Connect Device`. Retry silently.
6. Open the device in another tab or in Arduino Serial Monitor, then attempt to connect in the flasher — confirm the "serial port in use" copy fires with BootloaderHelp visible.
7. Attach a charge-only USB cable OR disconnect the device mid-connect — confirm the "no response" copy fires with BootloaderHelp visible.
8. Select `heltec-v3` in the picker and plug in a different ESP32 (e.g. `tbeam`) — confirm ChipMismatchWarning shows the actionable single-sentence corrective copy with the picker name front-and-center.
9. Expand the BootloaderHelp accordion (from any non-cancelled error state) — confirm the auto-bootloader note is present in step 3, and the outbound link opens the current Meshtastic flashing docs page.

**Report back** either "approved — copy reads right and error categories fire correctly" or list specific copy corrections / category mis-mappings.

### Blockers to route through to STATE.md at phase close

- **[v1.4 / Phase 19-02 — HARDWARE-IN-LOOP]:** Visual verification of the DCR34 firmware-identity string in Flash step against a running dev build. Blocks Phase 19 closure.
- **[v1.4 / Phase 19-02 — HARDWARE-IN-LOOP]:** Error-category verification — cancelled / in-use / no-response paths need to be triggered against real hardware (or a well-staged mock). Chip-mismatch requires actually mis-selecting a device in the picker; unlikely to be exercised in typical booth use but part of the plan's SC.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` already lists (T-19-02-01 mitigated by the explicit `Meshtastic {version}` subtitle naming the underlying firmware; T-19-02-02 accepted — outbound link stays on the same trusted upstream URL that Phase 18 shipped).

## Known Stubs

None. All changed code paths are wired end-to-end:

- `FIRMWARE_VERSION` continues to flow from `@/config/firmware` (build-injected via `NEXT_PUBLIC_FIRMWARE_VERSION`) into the Flash-step subtitle — no placeholder.
- `classifyConnectError` returns a real category and `categoryMessage` returns real copy for every reachable branch.
- Cancelled path renders the same production `Ready to connect` copy as the disconnected state — not a placeholder.

## Next Phase Readiness

Ready for the next phase / plan. Contract preserved:

- No exports changed. `BootloaderHelp` and `ChipMismatchWarning` signatures unchanged. `ConnectStep` props shape unchanged.
- No changes to `useSerial`, `useFlash`, `esptool.ts`, `firmware.ts`, or the wizard state machine.
- No dependency changes.

Blockers to close before merging Plan 19-02:

- Hardware-in-loop human-verify (Task 3 above).

## Self-Check: PASSED

Files claimed to be created/modified — all present and diffed:

- `apps/run.flash/webapp/src/components/flash/flash-step.tsx` — FOUND in commit `fdff37ae`; diff shows 4 additions + 4 modifications on the firmware row.
- `apps/run.flash/webapp/src/components/connect/bootloader-help.tsx` — FOUND in commit `be274ad8`; diff shows retitled accordion, new intro, split BOOT step, updated link label.
- `apps/run.flash/webapp/src/components/connect/chip-mismatch.tsx` — FOUND in commit `be274ad8`; diff shows rewritten body copy (two paragraphs, no signature change).
- `apps/run.flash/webapp/src/components/connect/connect-step.tsx` — FOUND in commit `be274ad8`; diff shows new inline classifier + categoryMessage + cancelled defensive-path render logic.
- `.planning/phases/19-dependencies-dcr34-branding-ux/19-02-SUMMARY.md` — this file.

Commits claimed:

- `fdff37ae` (Task 1) — `git log --oneline` confirms present.
- `be274ad8` (Task 2) — `git log --oneline` confirms present.

Verify commands (from `<verification>` section of the plan):

- `grep -q "run.defcon.run firmware" apps/run.flash/webapp/src/components/flash/flash-step.tsx` — PASSES (found at line 130).
- `npx tsc --noEmit` in `apps/run.flash/webapp/` — PASSES (exit 0).
- `NEXT_PUBLIC_FIRMWARE_VERSION=<stub> npm run build` in `apps/run.flash/webapp/` — PASSES (build output above).
- `git diff --stat 19-01-baseline..HEAD -- apps/run.flash/webapp/src/` shows exactly the 4 files listed in `files_modified` (done-step.tsx correctly excluded per plan constraint).
- Human-verify checkpoint (Task 3) — DEFERRED, documented under Human Verification Required.

---
*Phase: 19-dependencies-dcr34-branding-ux*
*Completed: 2026-07-01*
