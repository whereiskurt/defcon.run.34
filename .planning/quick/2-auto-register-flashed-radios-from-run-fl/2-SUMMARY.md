---
phase: quick
plan: 2
subsystem: api
tags: [meshtastic, web-serial, registration, run-flash, run-human, internal-api]

# Dependency graph
requires:
  - phase: existing
    provides: run.flash configure pipeline, run.human meshtastic radios entity
provides:
  - Auto-registration pipeline from run.flash to run.human for flashed radios
  - DeviceRegistrationInfo type capturing nodeId and privateKey from device
  - Internal /api/internal/meshtastic-radios endpoint for server-to-server registration
affects: [run.flash, run.human, meshtastic-radios]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget registration, server-to-server proxy with x-internal-secret]

key-files:
  created:
    - apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
    - apps/run.flash/webapp/src/app/api/register-radio/route.ts
  modified:
    - apps/run.flash/webapp/src/lib/meshtastic.ts
    - apps/run.flash/webapp/src/hooks/use-configure.ts

key-decisions:
  - "Fire-and-forget registration -- never blocks flash completion UI"
  - "Auto-verified + impersonate enabled for flashed radios (no email verification needed)"
  - "Idempotent re-flash updates private key without creating duplicate"

patterns-established:
  - "Fire-and-forget pattern: background fetch().catch() for non-critical side effects"
  - "Internal API proxy: run.flash authenticates user, forwards to run.human with x-internal-secret"

requirements-completed: [QUICK-2]

# Metrics
duration: 4min
completed: 2026-03-13
---

# Quick Task 2: Auto-Register Flashed Radios Summary

**Four-file registration pipeline capturing device nodeId/privateKey during Meshtastic configure handshake and auto-registering in run.human as verified+impersonate radio**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T03:14:50Z
- **Completed:** 2026-03-13T03:18:57Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Device events (onMyNodeInfo, onConfigPacket) captured during configure handshake to extract nodeId and privateKey
- connectMeshtasticDevice() returns { device, registrationInfo } with captured data
- Fire-and-forget registration POST after successful config push -- never blocks user
- Internal run.human endpoint creates verified+impersonate radios or updates privateKey on re-flash

## Task Commits

Each task was committed atomically:

1. **Task 1: Capture device info during configure + create run.human internal endpoint** - `c4b73350` (feat)
2. **Task 2: Wire up registration flow in use-configure hook + create run.flash proxy route** - `fa05249e` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/src/lib/meshtastic.ts` - Added DeviceRegistrationInfo type, event subscriptions in configureWithRetry()
- `apps/run.flash/webapp/src/hooks/use-configure.ts` - Destructures new return type, fire-and-forget POST to /api/register-radio
- `apps/run.flash/webapp/src/app/api/register-radio/route.ts` - Authenticated proxy route forwarding to run.human internal API
- `apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts` - Internal POST endpoint resolving OIDC sub, creating/updating radios

## Decisions Made
- Fire-and-forget registration: registration failure must never block the flash completion UI since the radio is already flashed and working
- Auto-verified + impersonate: flashed radios skip email verification since device ownership is proven by physical flash
- Quota enforcement on new radios via existing quota-client pattern
- Dev mode gracefully skips registration when RUN_HUMAN_INTERNAL_URL is not configured

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript narrowing issue with captured event variables**
- **Found during:** Task 1 (meshtastic.ts)
- **Issue:** TypeScript narrowed closure-captured `let` variables to `never` type after null checks
- **Fix:** Used object wrapper `captured: { nodeNum, privateKey }` instead of separate `let` variables
- **Files modified:** apps/run.flash/webapp/src/lib/meshtastic.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** c4b73350 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor TypeScript pattern adjustment for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - uses existing RUN_HUMAN_INTERNAL_URL and AUTH_INTERNAL_SECRET environment variables already configured for the /api/config route.

## Next Phase Readiness
- Registration pipeline is complete end-to-end
- Requires existing env vars (RUN_HUMAN_INTERNAL_URL, AUTH_INTERNAL_SECRET) already in production

---
*Phase: quick*
*Completed: 2026-03-13*
