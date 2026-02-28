# Phase 3: Config Engine + Server API - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

After flashing, the app automatically configures the device with the user's MQTT credentials, DCR34 channels, identity, and radio settings — all served securely from the server. This phase delivers: @meshtastic/core integration for device configuration over Web Serial, an authenticated /api/config endpoint serving per-user secrets, the Configure wizard step with progress UI, and the Done screen. Device flashing is Phase 2 (complete). Docker deployment is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Config Push Progress UX
- Reuse the FlashPipeline staged pipeline pattern — four stages: MQTT → Channels → Identity → Radio, each with inline checkmark on completion
- Real-time speed — no artificial delays. Push each config as fast as the device accepts it
- Show category + summary value for each stage (e.g., "MQTT: mqtt.defcon.run" → "MQTT: mqtt.defcon.run ✓"). No secrets shown (no PSK/password)
- Fail entire config on any step failure — uses transactional edit (beginEditSettings/commitEditSettings) for atomic apply. Partial config is rolled back, user retries from scratch

### Done Screen
- Quick celebration + info: brief teal glow/checkmark moment, then practical summary
- Full config summary: long name, short name, MQTT server, channels configured, radio region/preset
- Next steps: 1) Register your radio on run.defcon.run (link out) 2) Download Meshtastic app to monitor your device 3) Disconnect USB
- "Flash Another Device" button — resets the wizard for provisioning multiple boards at the DEF CON booth

### Config Values & Stub Defaults
- Hardcoded stub values in dev mode (NODE_ENV !== 'production') — zero env var setup needed to run locally. Production reads env vars
- Per-user MQTT credentials: Claude's discretion on generation approach (derived from user ID or provisioned — researcher/planner decide)
- Identity source: Claude's discretion (session display name vs RunUser entity lookup — researcher/planner decide based on what's available)
- Two channels as described in design doc: Primary "DCR34" with event PSK, Secondary "defcon" bridge channel with separate PSK
- All config values env-driven in production with stub defaults for dev

### Post-flash Reconnection
- Claude's discretion on reconnection approach — depends on what @meshtastic/core and Web Serial support for port reuse after device reboot
- Claude's discretion on timeout, retry behavior, and port reuse strategy
- If auto-reconnect fails: Claude's discretion on fallback (manual connect button, auto-retry, etc.)

### Claude's Discretion
- @meshtastic/core integration approach (transport setup, protobuf config format)
- Post-flash reconnection strategy (port reuse, polling, timeout values)
- MQTT credential generation mechanism
- Identity source (session name vs RunUser entity lookup)
- /api/config response structure and error handling
- Config transaction implementation details (beginEditSettings/commitEditSettings)
- Reconnection fallback behavior

</decisions>

<specifics>
## Specific Ideas

- Config progress pipeline should visually match the Flash pipeline (Erase/Write/Verify) so the whole wizard has a consistent "staged pipeline with checkmarks" language
- Done screen should feel like an achievement at DEF CON — brief teal glow celebration before the practical info
- "Flash Another Device" button supports the booth scenario where a volunteer provisions multiple devices in a row
- The design doc specifies the /api/config response shape — use that as the contract

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FlashPipeline` component: three-stage pipeline with inline checkmarks — can be generalized or duplicated for 4-stage config pipeline
- `FlashConsole` component: expandable accordion with raw serial output — reusable for config push logs
- `useSerial` hook: holds `espLoaderRef` and `transportRef` — config step needs the serial port, not the ESPLoader
- `useWizard` hook: manages step progression, "configure" and "done" steps already defined
- `WizardContainer`: renders PlaceholderStep for "configure" and "done" — ready to replace
- Auth session via next-auth: `session.user.id`, `session.user.name`, `session.user.email` available server-side
- Config pattern: `src/config/` with frozen objects derived from env vars

### Established Patterns
- API route pattern: check session → check claims → try/catch business logic → NextResponse.json
- Glass-card + teal theme for success states
- HeroUI + Tailwind for all UI
- AnimatePresence for wizard step transitions

### Integration Points
- `WizardContainer` lines 117-133: replace PlaceholderStep for "configure" and "done"
- `useSerial.transportRef`: config step needs the underlying serial port/transport, not ESPLoader
- `src/app/api/config/route.ts`: new API route needed
- `package.json`: needs @meshtastic/core and @meshtastic/transport-web-serial dependencies
- Flash step "Continue to Configure" button already calls `advance()` to move to configure step

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-config-engine-server-api*
*Context gathered: 2026-02-28*
