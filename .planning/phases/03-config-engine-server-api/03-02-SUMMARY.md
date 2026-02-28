---
phase: 03-config-engine-server-api
plan: 02
subsystem: firmware
tags: [meshtastic, web-serial, protobuf, device-config, react-hook, bufbuild]

# Dependency graph
requires:
  - phase: 03-config-engine-server-api
    plan: 01
    provides: "DeviceConfigPayload types, GET /api/config endpoint, meshtasticConfig"
  - phase: 02-flash-engine
    provides: "useFlash/useSerial hook patterns, esptool.ts wrapper pattern"
provides:
  - "connectMeshtasticDevice: Web Serial reconnection with port reuse, reboot delay, retry"
  - "pushDeviceConfig: MQTT/channels/identity/radio push with transactional commit"
  - "useConfigure hook with ConfigProgress state and configPayload for Done screen"
affects: [03-03]

# Tech tracking
tech-stack:
  added: ["@bufbuild/protobuf@2.8.0"]
  patterns: ["protobuf create() for @meshtastic/core API messages", "string-to-enum mapping for region/modem codes", "configure handshake with DeviceConfigured event subscription"]

key-files:
  created:
    - apps/run.flash/webapp/src/lib/meshtastic.ts
    - apps/run.flash/webapp/src/hooks/use-configure.ts
  modified:
    - apps/run.flash/webapp/package.json
    - apps/run.flash/webapp/package-lock.json

key-decisions:
  - "Installed @bufbuild/protobuf@2.8.0 for create() function -- @meshtastic/core bundles protobufs internally but does not export create()"
  - "MQTT config uses setModuleConfig() (ModuleConfig), not setConfig() (Config) -- verified from @meshtastic/core source"
  - "TransportWebSerial.createFromPort() for port reuse after flash -- no user gesture needed since permission was already granted"
  - "configure() handshake verified via onDeviceStatus event subscription waiting for DeviceConfigured status"

patterns-established:
  - "Protobuf message construction: import {create} from @bufbuild/protobuf, use Protobuf.*.Schema from @meshtastic/core"
  - "Config/ModuleConfig payloadVariant pattern: case string matches proto field name (e.g., 'lora', 'mqtt')"
  - "Event-based completion detection: subscribe to device events, resolve promise on target status"

requirements-completed: [CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 3 Plan 2: Config Engine Client Summary

**@meshtastic/core wrapper with Web Serial reconnection, protobuf config push (MQTT/channels/identity/radio), and useConfigure React hook with progress tracking**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T20:13:36Z
- **Completed:** 2026-02-28T20:19:09Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Complete @meshtastic/core wrapper library encapsulating all device communication (connect, configure, push config, disconnect)
- Protobuf-correct config push: MQTT via setModuleConfig, LoRa via setConfig, channels via setChannel, identity via setOwner
- useConfigure hook with full pipeline orchestration: disconnect esptool -> reconnect meshtastic -> fetch /api/config -> push all config stages -> commit
- Base64 PSK decoding with 0/16/32 byte validation, region/modem preset enum mapping with all Meshtastic-supported values

## Task Commits

Each task was committed atomically:

1. **Task 1: Create @meshtastic/core wrapper library** - `e193ded` (feat)
2. **Task 2: Create useConfigure hook orchestrating config push pipeline** - `3a91f46` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/src/lib/meshtastic.ts` - Wrapper for connectMeshtasticDevice, pushDeviceConfig, disconnectMeshtasticDevice
- `apps/run.flash/webapp/src/hooks/use-configure.ts` - React hook orchestrating config push pipeline with ConfigProgress state
- `apps/run.flash/webapp/package.json` - Added @bufbuild/protobuf dependency
- `apps/run.flash/webapp/package-lock.json` - Lockfile updated

## Decisions Made
- Installed `@bufbuild/protobuf@2.8.0` as direct dependency because `@meshtastic/core` bundles `create()` internally but doesn't export it -- needed for constructing protobuf messages to pass to setConfig/setModuleConfig/setChannel/setOwner
- MQTT config confirmed as ModuleConfig (not Config) from source inspection of `@meshtastic/core/dist/mod.js`
- Used `TransportWebSerial.createFromPort()` static method instead of constructor -- handles port.open() automatically if needed
- Added `type` import for MeshDevice in use-configure.ts for useRef typing -- erased at compile time, doesn't break wrapper encapsulation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @bufbuild/protobuf dependency**
- **Found during:** Task 1 (meshtastic.ts implementation)
- **Issue:** @meshtastic/core bundles @bufbuild/protobuf internally but does not export the `create()` function needed to construct protobuf messages for setConfig/setModuleConfig/setChannel/setOwner
- **Fix:** `npm install @bufbuild/protobuf@2.8.0` (matching version bundled in @meshtastic/core)
- **Files modified:** package.json, package-lock.json
- **Verification:** npm run build passes, protobuf messages correctly constructed
- **Committed in:** e193ded (Task 1 commit)

**2. [Rule 1 - Bug] Added explicit type annotation for event handler parameter**
- **Found during:** Task 1 (build verification)
- **Issue:** TypeScript strict mode flagged `status` parameter in onDeviceStatus.subscribe callback as implicitly `any`
- **Fix:** Added `: Types.DeviceStatusEnum` type annotation to the callback parameter
- **Files modified:** src/lib/meshtastic.ts
- **Verification:** npm run build passes with no type errors
- **Committed in:** e193ded (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correct compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - all @meshtastic/core API usage is client-side browser code. No environment variables or external services needed beyond what Plan 01 already configured.

## Next Phase Readiness
- useConfigure hook ready for UI integration in Plan 03 (configure step and done screen)
- configPayload stored after fetch for Done screen to display config summary
- lib/meshtastic.ts fully encapsulates @meshtastic/core -- UI components only need to call useConfigure

## Self-Check: PASSED

- All 2 created files verified present on disk
- Both task commits (e193ded, 3a91f46) verified in git log
- npm run build passes with no errors
- All 4 exported functions verified: connectMeshtasticDevice, pushDeviceConfig, disconnectMeshtasticDevice, useConfigure
- MeshDevice in useRef, not useState
- PSK base64 decoding with length validation present
- commitEditSettings called after all config pushes
- No direct @meshtastic/core imports in hooks (only type import for MeshDevice ref typing)

---
*Phase: 03-config-engine-server-api*
*Completed: 2026-02-28*
