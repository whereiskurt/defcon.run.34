# Phase 2: Flash Engine - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can connect their ESP32 via USB and flash DCR34-pinned Meshtastic firmware with real-time progress feedback. This phase delivers Web Serial connection handling and esptool.js firmware flashing with progress UI. Device configuration (MQTT, channels, identity, radio settings) is Phase 3. Firmware vendoring into Docker image is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Connection Step UX
- Show selected device name and image at top of Connect step as confirmation, then connect button below
- After successful connection: show connected status (port name, chip info if available) with manual "Continue to Flash" button — no auto-advance
- Bootloader guidance on connection failure: expandable troubleshooting section, hidden by default. Brief error message visible, detailed bootloader steps in expandable
- Bootloader instructions: generic ESP32 guidance ("Hold BOOT, press RESET") plus link to device-specific Meshtastic docs page

### Flash Progress Display
- Staged pipeline visualization: three distinct stages — Erase → Write → Verify — each with its own progress indicator
- The Write stage gets the detailed percentage bar (longest operation)
- Moderate detail level: stage name + percentage + bytes transferred (e.g., "Writing firmware... 47% (384KB / 816KB)")
- Hidden expandable console at bottom — "Show details" toggle reveals raw esptool serial output. Hidden by default
- Flash success: all three pipeline stages turn green with checkmarks. Brief summary text. "Continue to Configure" button below

### Pre-flash Confirmation
- Manual flash start — user must click "Flash Firmware" button explicitly. No auto-start, no countdown
- Clear erase warning before flash button: "This will erase all existing firmware and data on the device"
- Pre-flash info panel shows: device name, detected chip info from serial connection, firmware version, firmware file size
- Chip validation: compare detected chip family (e.g., ESP32-S3) against selected device's architecture. Mismatch blocks flash with clear warning — "Connected chip doesn't match selected device"

### Error & Recovery UX
- Mid-flash disconnect: guided step-by-step recovery (1. Don't panic 2. Reconnect USB 3. Put device in bootloader mode 4. Click Retry)
- Retry sends user back to Connect step — clean slate, guarantees fresh serial connection before reflashing
- Verification failure treated as flash failure — full retry from erase, no "continue anyway" option
- Unlimited retries — no artificial retry limits

### Claude's Discretion
- Exact progress bar/pipeline component styling and animations
- esptool.js integration approach and configuration (baud rate, flash mode, memory addresses)
- Firmware binary loading mechanism (static files vs API route)
- Console log formatting and scroll behavior
- Transition animations between stages

</decisions>

<specifics>
## Specific Ideas

- The staged pipeline (Erase → Write → Verify) should feel like completing a checklist — stages light up green with checkmarks as they complete
- DEF CON crowd appreciates technical detail — show bytes transferred, chip info, firmware size. Not terminal-level verbose, but more than a simple spinner
- The expandable console is for curious hackers who want to see the raw serial output, but it should never be in the way for casual users

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useWizard` hook: manages step progression, selectedDevice state, advance/goToStep — Phase 2 uses `advance()` after connect and flash complete
- `WizardContainer`: renders step content with AnimatePresence transitions — "connect" and "flash" PlaceholderSteps will be replaced with real components
- `DeviceHardware` type: includes `platformioTarget`, `architecture`, `partitionScheme` — used for firmware file selection and chip validation
- `getFirmwareFilename(device, version)`: already constructs firmware binary filename
- `glass-card` CSS class: established card styling pattern
- HeroUI components: Button, Card, CardBody, plus Framer Motion for transitions
- Lucide icons: Usb, Cpu already imported in wizard-container.tsx

### Established Patterns
- Client components with "use client" directive
- HeroUI + Tailwind 4 for all UI styling
- AnimatePresence with motion.div for step transitions (opacity + y offset)
- Hook-based state management (custom hooks in src/hooks/)
- Centralized config in src/config/ with frozen config objects

### Integration Points
- `WizardContainer` switch statement at lines 68-110 — replace PlaceholderStep for "connect" and "flash" with real components
- `useWizard` hook needs extension — add serial port state, connection status, flash progress state
- `package.json` needs esptool.js dependency (not installed yet)
- Firmware binaries need to be served from the app (public/ directory or API route)
- No Web Serial types installed — will need @types/web or lib declarations

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-flash-engine*
*Context gathered: 2026-02-28*
