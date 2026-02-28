---
phase: 01-app-scaffold-device-picker
plan: 02
subsystem: ui
tags: [web-serial, device-picker, wizard, heroui, framer-motion, meshtastic, esp32, svg]

# Dependency graph
requires:
  - phase: 01-app-scaffold-device-picker/01
    provides: Next.js app shell, OIDC auth, layout, CSS system (glass-card, noise-overlay)
provides:
  - Browser gate blocking non-Chromium browsers with download links
  - Wizard stepper with 5-step horizontal progress bar and back navigation
  - useWizard hook managing step state, device selection, and advancement
  - Interactive device picker grid with search, manufacturer filter, and recommended badges
  - Vendored Meshtastic hardware-list.json and ESP32 device SVGs
  - DeviceHardware TypeScript interface and ESP32 filter/sort utilities
affects: [02-flash-engine, 03-config-api, 04-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: [browser-gate-ssr-safe, wizard-state-hook, vendored-device-data, manufacturer-chip-filter]

key-files:
  created:
    - apps/run.flash/webapp/src/types/device.ts
    - apps/run.flash/webapp/src/hooks/use-wizard.ts
    - apps/run.flash/webapp/src/config/devices.ts
    - apps/run.flash/webapp/src/components/browser-gate.tsx
    - apps/run.flash/webapp/src/components/header/header.tsx
    - apps/run.flash/webapp/src/components/wizard/wizard-stepper.tsx
    - apps/run.flash/webapp/src/components/wizard/wizard-container.tsx
    - apps/run.flash/webapp/src/components/device-picker/device-grid.tsx
    - apps/run.flash/webapp/src/components/device-picker/device-card.tsx
    - apps/run.flash/webapp/src/components/device-picker/device-search.tsx
    - apps/run.flash/webapp/src/components/device-picker/device-not-found.tsx
    - apps/run.flash/webapp/public/data/hardware-list.json
    - apps/run.flash/webapp/public/img/devices/ (38 SVGs)
  modified:
    - apps/run.flash/webapp/src/app/page.tsx
    - apps/run.flash/webapp/src/app/layout.tsx

key-decisions:
  - "Used !important Tailwind modifiers for selected card border to override glass-card:hover pseudo-class"
  - "Vendored hardware-list.json and SVGs statically rather than fetching at runtime"
  - "Deduplication by hwModel to avoid showing multiple platformioTarget variants of same hardware"

patterns-established:
  - "Browser gate pattern: SSR-safe via useEffect + useState(null) for loading/supported/unsupported states"
  - "Wizard state hook: useWizard returns step state, device selection, and navigation -- single source of truth"
  - "Device data vendoring: curl from Meshtastic web-flasher repo, filter ESP32 devices only"
  - "Manufacturer filter: extract unique tags from device data, render as clickable Chip row"

requirements-completed: [BRWS-01, DEVC-01, DEVC-02, DEVC-03, DEVC-04, DEVC-05, WZRD-01, WZRD-02, WZRD-03]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 1 Plan 2: Browser Gate, Wizard, and Device Picker Summary

**Browser compatibility gate, 5-step wizard with horizontal stepper, and interactive ESP32 device picker with vendored Meshtastic hardware data, SVG images, search, manufacturer filtering, and recommended badges**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T14:34:55Z
- **Completed:** 2026-02-28T14:39:49Z
- **Tasks:** 3 (2 auto + 1 checkpoint with fix)
- **Files modified:** 52

## Accomplishments
- Browser gate detects Web Serial API support and blocks unsupported browsers (Firefox, Safari) with styled download links for Chrome/Edge
- Custom horizontal wizard stepper shows all 5 steps with current/completed/future visual states and back navigation
- Interactive device picker grid with 38 vendored ESP32 device SVGs, real-time search, manufacturer chip filters, recommended badges, and architecture badges
- Wizard state hook manages step progression with device selection validation -- selecting a device and confirming advances to Connect step

## Task Commits

Each task was committed atomically:

1. **Task 1: Browser gate, wizard stepper, and wizard state management** - `aa524aa` (feat)
2. **Task 2: Vendor device data and build interactive device picker** - `d053858` (feat)
3. **Task 3: Fix device card selected border appearing immediately on click** - `0356e2e` (fix)

## Files Created/Modified
- `apps/run.flash/webapp/src/types/device.ts` - DeviceHardware interface, ESP32 architecture constants, filter helpers
- `apps/run.flash/webapp/src/hooks/use-wizard.ts` - Wizard state management hook with step progression and device selection
- `apps/run.flash/webapp/src/config/devices.ts` - Device data helpers: recommended list, image paths, manufacturer extraction, sorting, deduplication
- `apps/run.flash/webapp/src/components/browser-gate.tsx` - Web Serial API detection gate with unsupported browser message
- `apps/run.flash/webapp/src/components/header/header.tsx` - Minimal wizard header with logo and user avatar dropdown
- `apps/run.flash/webapp/src/components/wizard/wizard-stepper.tsx` - Custom horizontal stepper bar with 5 steps
- `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` - Wizard step container with framer-motion transitions
- `apps/run.flash/webapp/src/components/device-picker/device-grid.tsx` - Device card grid with filtering and sorting
- `apps/run.flash/webapp/src/components/device-picker/device-card.tsx` - Individual device card with image, name, manufacturer, architecture badge
- `apps/run.flash/webapp/src/components/device-picker/device-search.tsx` - Search input and manufacturer chip filter row
- `apps/run.flash/webapp/src/components/device-picker/device-not-found.tsx` - Empty state with link to Meshtastic flasher
- `apps/run.flash/webapp/public/data/hardware-list.json` - Vendored Meshtastic hardware device list
- `apps/run.flash/webapp/public/img/devices/` - 38 vendored device SVGs (including unknown.svg fallback)
- `apps/run.flash/webapp/src/app/page.tsx` - Updated to render BrowserGate wrapping WizardContainer
- `apps/run.flash/webapp/src/app/layout.tsx` - Updated to include Header component

## Decisions Made
- Used `!important` Tailwind modifiers (`!border-primary/60`, `!shadow-[...]`) for selected card styles to ensure they override `.glass-card:hover` pseudo-class -- the green/teal border appears immediately on click without requiring hover-off
- Vendored hardware-list.json and device SVGs statically from Meshtastic web-flasher repo rather than fetching at runtime, ensuring zero external dependencies
- Deduplication by `hwModel` to avoid showing multiple platformioTarget variants of the same physical hardware in the picker

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Device card selected border not appearing immediately on click**
- **Found during:** Task 3 (checkpoint human-verify)
- **Issue:** The `.glass-card:hover` CSS pseudo-class set `border-color` and `box-shadow` that competed with the `isSelected` Tailwind classes (`ring-2 ring-primary`). The selected state border only appeared after moving the mouse away from the card.
- **Fix:** Added `!border-primary/60` and `!shadow-[0_0_16px_#00d4aa40]` with Tailwind's `!important` modifier to the `isSelected` conditional classes, ensuring they override the hover pseudo-class.
- **Files modified:** `apps/run.flash/webapp/src/components/device-picker/device-card.tsx`
- **Verification:** Build passes, user confirmed fix resolves the issue
- **Committed in:** `0356e2e`

---

**Total deviations:** 1 auto-fixed (1 bug fix from user feedback at checkpoint)
**Impact on plan:** Single-line CSS fix for hover/selected state priority. No scope creep.

## Issues Encountered
None beyond the checkpoint feedback item (documented as deviation above).

## User Setup Required
None - no external service configuration required. Device data is vendored statically.

## Next Phase Readiness
- Phase 1 is fully complete: app scaffold, auth, browser gate, wizard, and device picker are all functional
- The wizard's Connect/Flash/Configure/Done steps are placeholder shells ready for Phase 2 and Phase 3 implementation
- `useWizard` hook and `WizardContainer` are designed for extensibility -- Phase 2 will add serial connection UI to the Connect step
- `DeviceHardware` type and `getFirmwareFilename` utility are ready for Phase 2's firmware download logic
- No blockers for Phase 2

## Self-Check: PASSED

- All 12 key files: FOUND
- 38 device SVGs: FOUND
- Commit aa524aa (Task 1): FOUND
- Commit d053858 (Task 2): FOUND
- Commit 0356e2e (Task 3 fix): FOUND

---
*Phase: 01-app-scaffold-device-picker*
*Completed: 2026-02-28*
