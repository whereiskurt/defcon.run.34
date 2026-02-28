---
phase: 02-flash-engine
plan: 01
subsystem: flash
tags: [esptool-js, web-serial, esp32, firmware, react-hooks, typescript]

# Dependency graph
requires:
  - phase: 01-app-scaffold-device-picker
    provides: "DeviceHardware type, device config, useWizard hook, Next.js app scaffold"
provides:
  - "esptool-js wrapper library (connectToDevice, validateChipMatch, createTerminalLogger)"
  - "useSerial hook for Web Serial connection lifecycle with chip detection"
  - "useFlash hook for staged flash pipeline (erase->write->verify) with progress"
  - "Serial/flash TypeScript type contracts (SerialConnectionState, FlashStage, FlashProgress, ChipInfo)"
  - "Firmware config with version pinning, factory filename builder, and binary loader"
  - "Firmware download script for development"
affects: [02-flash-engine, 03-config-api]

# Tech tracking
tech-stack:
  added: [esptool-js@0.5.7, "@types/w3c-web-serial@1.0.8"]
  patterns: [esptool-wrapper-library, serial-hook-lifecycle, staged-flash-pipeline, binary-string-conversion]

key-files:
  created:
    - apps/run.flash/webapp/src/types/serial.ts
    - apps/run.flash/webapp/src/config/firmware.ts
    - apps/run.flash/webapp/src/lib/esptool.ts
    - apps/run.flash/webapp/src/hooks/use-serial.ts
    - apps/run.flash/webapp/src/hooks/use-flash.ts
    - apps/run.flash/webapp/scripts/download-firmware.sh
    - apps/run.flash/webapp/public/firmware/.gitkeep
    - apps/run.flash/webapp/.gitignore
  modified:
    - apps/run.flash/webapp/package.json

key-decisions:
  - "Binary string conversion for esptool-js: writeFlash API expects string data, not Uint8Array -- added uint8ToBinaryString helper with chunked processing"
  - "romBaudrate required by esptool-js LoaderOptions: set to 115200 matching DEFAULT_BAUDRATE for initial ROM bootloader communication"
  - "ESPLoader and Transport stored in useRef, not useState -- mutable class instances with internal state must not be in React state"

patterns-established:
  - "esptool.ts wrapper pattern: all direct esptool-js API calls go through lib/esptool.ts, hooks/components call wrapper functions"
  - "Staged flash pipeline: separate eraseFlash() then writeFlash({ eraseAll: false }) for distinct Erase/Write progress stages"
  - "Console log capture: createTerminalLogger feeds IEspLoaderTerminal output to React state for expandable debug console"
  - "Connection error mapping: getConnectionErrorMessage translates raw errors to user-actionable messages"

requirements-completed: [CONN-01, CONN-02, FLSH-01, FLSH-02, FLSH-03, FLSH-05]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 2 Plan 1: Flash Engine Foundation Summary

**esptool-js wrapper library with useSerial/useFlash hooks providing Web Serial connection lifecycle and staged erase/write/verify flash pipeline with progress callbacks**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T15:51:21Z
- **Completed:** 2026-02-28T15:56:21Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Installed esptool-js and Web Serial types, establishing the serial communication foundation
- Created complete TypeScript type contracts for serial connection state machine and flash pipeline stages
- Built esptool.js wrapper library isolating all direct API interaction with connection, chip detection, and validation helpers
- Implemented useSerial hook encapsulating Web Serial + ESPLoader lifecycle with chip detection, error handling, and console capture
- Implemented useFlash hook orchestrating three-stage flash pipeline (erase, write, verify) with real-time progress callbacks
- Created firmware config with version pinning, factory binary loader, and download script for development

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create type contracts + firmware config** - `6882b63` (feat)
2. **Task 2: Build esptool.js wrapper library, useSerial hook, and useFlash hook** - `d12ecb1` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/package.json` - Added esptool-js and @types/w3c-web-serial dependencies
- `apps/run.flash/webapp/src/types/serial.ts` - SerialConnectionState, FlashStage, FlashProgress, ChipInfo, ConsoleEntry types
- `apps/run.flash/webapp/src/config/firmware.ts` - FIRMWARE_VERSION, getFactoryFilename, loadFirmware (binary string), formatBytes
- `apps/run.flash/webapp/src/lib/esptool.ts` - connectToDevice, validateChipMatch, createTerminalLogger, getConnectionErrorMessage
- `apps/run.flash/webapp/src/hooks/use-serial.ts` - useSerial hook with connect/disconnect/connectionState/chipInfo/consoleLogs
- `apps/run.flash/webapp/src/hooks/use-flash.ts` - useFlash hook with flash/reset/progress/isFlashing/isComplete/isError
- `apps/run.flash/webapp/scripts/download-firmware.sh` - Downloads pinned Meshtastic firmware from GitHub releases
- `apps/run.flash/webapp/public/firmware/.gitkeep` - Placeholder for firmware binary directory
- `apps/run.flash/webapp/.gitignore` - Ignores firmware binaries, preserves .gitkeep

## Decisions Made
- **Binary string for esptool-js data:** The actual esptool-js v0.5.7 FlashOptions.fileArray expects `data: string` (binary string), not `Uint8Array` as suggested by research. Added `uint8ToBinaryString()` helper with chunked processing to avoid stack overflow on large firmware files.
- **romBaudrate required:** LoaderOptions in v0.5.7 requires `romBaudrate` as a non-optional field. Set to 115200 matching the default baudrate for initial ROM bootloader communication.
- **ESPLoader/Transport in refs:** Stored mutable esptool-js class instances in `useRef` instead of `useState` to avoid React re-render issues with stateful objects -- per research anti-patterns guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed esptool-js FlashOptions data type mismatch**
- **Found during:** Task 2 (useFlash hook build verification)
- **Issue:** Plan specified `Uint8Array` for firmware data, but esptool-js v0.5.7 FlashOptions requires `data: string` (binary string)
- **Fix:** Updated loadFirmware() to return binary string via uint8ToBinaryString() helper with chunked conversion
- **Files modified:** apps/run.flash/webapp/src/config/firmware.ts
- **Verification:** npm run build succeeds, TypeScript types match
- **Committed in:** d12ecb1 (Task 2 commit)

**2. [Rule 1 - Bug] Added missing romBaudrate to ESPLoader constructor**
- **Found during:** Task 2 (build verification)
- **Issue:** esptool-js v0.5.7 LoaderOptions requires `romBaudrate` as a mandatory field, plan only specified `baudrate`
- **Fix:** Added `romBaudrate: DEFAULT_BAUDRATE` to ESPLoader constructor options
- **Files modified:** apps/run.flash/webapp/src/lib/esptool.ts
- **Verification:** npm run build succeeds, no TypeScript errors
- **Committed in:** d12ecb1 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs -- actual API differs from research docs)
**Impact on plan:** Both fixes were required for TypeScript compilation. The esptool-js v0.5.7 API has minor differences from the v0.5.6 docs referenced in research. No scope creep.

## Issues Encountered
- esptool-js is ESM-only, cannot be verified with `node -e "require('esptool-js')"` -- used Next.js build as the verification method instead.

## User Setup Required
None - no external service configuration required. Run `scripts/download-firmware.sh` to download firmware binaries for local development.

## Next Phase Readiness
- Serial connection and flash hooks are complete, ready for UI components in Plan 02
- useSerial provides espLoaderRef for useFlash consumption
- Console log capture is ready for the expandable debug console component
- Firmware config is ready for pre-flash info panel display
- validateChipMatch() is ready for chip architecture safety check in Connect step

## Self-Check: PASSED

All 9 created files verified present. Both task commits (6882b63, d12ecb1) verified in git log.

---
*Phase: 02-flash-engine*
*Completed: 2026-02-28*
