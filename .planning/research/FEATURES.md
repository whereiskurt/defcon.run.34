# Feature Landscape: Browser-Based ESP32 Meshtastic Flasher

**Domain:** Web-based device flasher and provisioner (flash.defcon.run)
**Researched:** 2026-02-28
**Confidence:** MEDIUM-HIGH (direct analysis of upstream Meshtastic flasher, ESP Web Tools, and 8+ competing tools)

## Table Stakes

Features users expect from a browser-based ESP32 flasher. Missing any of these makes the tool feel broken or unfinished. Every shipping web flasher in this space has these.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Browser compatibility gate** | Web Serial only works in Chrome/Edge. Users on Firefox/Safari hit a dead end with no explanation. Every flasher gates this upfront. | Low | Show clear message with browser download link. Meshtastic flasher, ESP Web Tools, ESPressoFlash all do this. |
| **Device/board picker** | Users must identify their hardware. The upstream Meshtastic flasher has "Select Target Device" as the first interaction. ESP Web Tools auto-detects chip but still needs device context for firmware selection. | Med | Meshtastic's `hardware-list.json` has ~122 devices with images, names, manufacturers, support tiers. Filter to ESP32 architectures only. Show device images -- visual identification is critical for non-technical users. |
| **USB connect flow with browser serial prompt** | The Web Serial API requires a user-initiated browser permission dialog. This is the standard interaction -- click Connect, browser shows port list, user picks port. Every single flasher does this identically. | Low | Browser-native UX. Cannot customize the serial port picker dialog. |
| **Flash progress indicator** | Users need to know flashing is working and how far along it is. A progress bar or percentage is universal. The Meshtastic flasher shows "a progress bar that you can monitor until it reaches 100%." esptool.js provides write progress callbacks. | Med | esptool.js exposes progress events. Show percentage + meaningful status text ("Erasing flash...", "Writing firmware...", "Verifying..."). |
| **Flash completion confirmation** | Clear success/failure state after flash completes. Users need to know "it worked" or "something went wrong." | Low | Green checkmark / success message. Error state with actionable guidance. |
| **Full erase option** | The Meshtastic flasher includes a "trash can icon" for factory erase. Fresh flash vs update is a meaningful distinction for Meshtastic devices since update preserves config. For DCR34 fresh provisioning, full erase is the default/only path. | Low | For DCR34, always full erase + fresh flash. No need for "update" mode since we are provisioning from scratch. |
| **HTTPS enforcement** | Web Serial API requires secure context. Production CloudFront handles this. localhost exempt for dev. Not a feature users see, but missing it breaks everything. | Low | Already handled by CloudFront deployment. |
| **Authentication requirement** | DCR34-specific but table stakes for this use case. Config includes per-user MQTT credentials, channel PSKs. Anonymous access would be a security hole. Every other DCR34 app requires OIDC auth. | Low | Existing OIDC pattern from run.human/run.gpx. Redirect to auth.defcon.run on unauthenticated visit. |

## Differentiators

Features that set flash.defcon.run apart from the generic Meshtastic flasher. These are the reasons to build a custom tool instead of just pointing users at flasher.meshtastic.org.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Integrated post-flash configuration** | THE core differentiator. The upstream Meshtastic flasher only flashes firmware -- users must then separately configure via the Meshtastic app or web client. flash.defcon.run flashes AND configures in one session. Zero manual config steps. | High | Uses `@meshtastic/core` + `@meshtastic/transport-web-serial` after flash completes. Pushes MQTT, channels, identity, radio settings programmatically. This is the entire reason this app exists. |
| **Per-user MQTT credential injection** | Each user gets unique MQTT auth pushed to their device automatically. No manual credential entry. Upstream flasher has zero awareness of user identity. | Med | Credentials already exist on RunUser entity. `/api/config` route serves them server-side only. Client fetches, pushes to device via @meshtastic/core. |
| **Event channel + PSK provisioning** | DCR34 primary channel with PSK, bridge channels to defcon.org -- all configured automatically. The DEF CON Meshtastic flasher (defcon.meshtastic.org) pre-configures the "DEFCONnect" channel in firmware, but our approach pushes config post-flash which is more flexible. | Med | Channel config pushed via @meshtastic/core. PSK served from server-side config, never in client JS bundle. |
| **Identity from DCR34 profile** | Long name and short name pulled from user's authenticated DCR34 identity. No manual name entry. Device immediately shows as "Runner Alice" on the mesh. | Low | Pull from OIDC claims / RunUser entity. 4-char short name derivation is the only logic needed. |
| **Pinned firmware version (no version picker)** | Eliminates decision paralysis. DCR34 vets 1-2 firmware versions. Users cannot pick the wrong firmware. The upstream flasher shows all available versions which confuses novice users. | Low | Actually a simplification -- LESS code than version picker. Firmware version is a deployment-time config value. |
| **Vendored firmware (zero external dependencies)** | Firmware binaries baked into Docker image. No runtime dependency on GitHub. At event time, GitHub outages or rate limits cannot break the tool. Upstream flasher fetches from GitHub in real-time. | Med | Build-time: download firmware ZIPs, extract per-device bins. Runtime: serve from local filesystem. Docker image is larger but fully self-contained. |
| **Step-by-step wizard flow** | Guided linear flow: Pick Device -> Connect -> Flash -> Configure -> Done. Each step has clear entry/exit criteria. Reduces cognitive load vs the Meshtastic flasher's more open-ended interface. | Med | Wizard state machine with 5 steps. Each step validates before allowing next. Back navigation allowed. Progress breadcrumb at top. |
| **Contextual bootloader guidance** | When connection fails, show device-specific instructions for entering bootloader mode (hold BOOT, press RESET). ESP32 boards have various button combinations. The upstream flasher's error handling is generic. | Med | Per-device bootloader instructions from hardware database or curated list. Show the specific button combo for the selected device. Huge UX win for non-technical users. |
| **Radio preset auto-configuration** | LoRa region (US), modem preset, hop limit pushed automatically. Users do not need to understand radio parameters. | Low | Static config values pushed via @meshtastic/core. Event-appropriate presets chosen by DCR34 organizers. |

## Anti-Features

Features to explicitly NOT build. Each would add complexity without proportional value for the DCR34 use case.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Firmware version picker** | DCR34 pins 1-2 vetted versions. Version choice confuses novice users, risks incompatible firmware. The upstream flasher already has this if anyone needs it. | Hardcode pinned version(s). Display version for transparency but do not allow selection. |
| **Custom firmware builds** | Massive scope. Build pipelines, compilation, custom modules. Not the problem we are solving. | Stock Meshtastic firmware only. |
| **Serial monitor / debug console** | The upstream Meshtastic flasher already has a built-in serial monitor. Building another adds maintenance burden for a feature used only by advanced users debugging issues. | Link to flasher.meshtastic.org for serial monitor needs. Or defer to a v2 "advanced" mode. |
| **BLE flashing** | The Meshtastic BLE flasher (liamcottle/meshtastic-flasher-ble) proves this is possible but has serious limitations: "firmware-ota does not send any events over BLE to tell us if flashing was successful." Web Serial is faster, more reliable, and the expected interaction for provisioning a brand-new device. | USB Web Serial only. BLE is for OTA updates of already-provisioned devices. |
| **Firefox/Safari support** | Web Serial API is Chromium-only. No polyfill exists. Building a workaround (e.g., native helper app) is massive scope for marginal user base. | Gate unsupported browsers at entry with clear messaging. |
| **Multi-region deployment** | Flashing requires physical USB connection. No user benefit from running in ca-central-1. Adds infrastructure complexity. | Single region (us-east-1) only. |
| **Radio registration from flasher** | Registration exists in run.human already. Adding it here duplicates UI and introduces cross-app API dependencies. | Optional "Register in DCR34" link pointing to run.human after provisioning complete. Defer integrated registration to v2. |
| **Device auto-detection** | ESP Web Tools auto-detects chip family from connected device. Sounds nice but the Meshtastic hardware database maps device -> firmware binary, not chip -> firmware. You need to know the exact board (e.g., "Heltec V3" not just "ESP32-S3") to select the correct firmware file. Auto-detection can only identify chip family, not board model. | User picks their device from visual picker. Chip architecture is derived from the selection, not the connection. |
| **Offline/PWA mode** | Service worker caching for offline use sounds appealing but the tool requires authentication (online), fetches per-user config (online), and vendored firmware means the Docker image IS the offline story. | Standard web app. Vendored firmware handles the "GitHub is down" scenario. |
| **Advanced flash settings** | Baud rate selection, flash mode (QIO/DIO), custom memory addresses. The esptool-js demo exposes these. For provisioning, these are footguns. Wrong settings can brick devices. | Use sensible defaults. esptool.js handles chip-appropriate settings automatically. |
| **Internationalization** | The upstream Meshtastic flasher supports 18 languages. DCR34 is a Las Vegas event, English is sufficient. i18n adds significant maintenance burden. | English only. |

## Feature Dependencies

```
Browser Compatibility Gate
  (no dependencies -- first thing checked)

Authentication (OIDC)
  -> Per-User Config API (/api/config)
    -> MQTT Credential Injection
    -> Channel + PSK Provisioning
    -> Identity Config (long name, short name)
    -> Radio Preset Config

Device Picker (hardware-list.json)
  -> Firmware Binary Selection (platformioTarget -> binary filename)
    -> Flash Step (esptool.js)
      -> Post-Flash Configuration Step (@meshtastic/core)
        -> MQTT Config Push
        -> Channel Config Push
        -> Identity Config Push
        -> Radio Config Push
          -> Success / Done Screen

USB Connect (Web Serial)
  -> Flash Step (esptool.js) -- same serial port
  -> Post-Flash Configuration Step (@meshtastic/core) -- reconnect after reboot

Vendored Firmware (build-time)
  -> Flash Step (serves binaries from local filesystem)
```

**Critical path:** Device Picker -> USB Connect -> Flash -> Reconnect -> Configure -> Done

**The reconnect after flash is the riskiest dependency.** After esptool.js writes firmware, the device reboots. The app must then establish a NEW @meshtastic/core connection over Web Serial to push config. This reboot + reconnect is where most failures will occur.

## MVP Recommendation

### Phase 1: Flash Only (proves the hard parts work)

Prioritize:
1. Browser compatibility gate (Low complexity, prevents support burden)
2. Device picker with images/filtering (Med complexity, core UX)
3. USB connect + flash with progress (Med complexity, core function)
4. Vendored firmware serving (Med complexity, reliability)
5. Step-by-step wizard skeleton (Med complexity, UX framework)

Defer: All post-flash configuration. Ship a tool that flashes firmware reliably. Configuration can be done manually via the Meshtastic app as a fallback.

### Phase 2: Configure (the differentiating value)

Prioritize:
1. Post-flash device reconnection (High complexity, critical path)
2. `/api/config` route with per-user MQTT credentials (Med complexity)
3. MQTT config push via @meshtastic/core (Med complexity)
4. Channel + PSK config push (Med complexity)
5. Identity config push (Low complexity)
6. Radio preset config push (Low complexity)

Defer: Radio registration integration, advanced error recovery.

### Phase 3: Polish

1. Contextual bootloader guidance per device (Med complexity)
2. Error recovery with retry logic (Med complexity)
3. Optional link to register radio in run.human (Low complexity)

**Rationale:** Phase 1 validates the hardest unknowns (esptool.js integration, firmware vendoring, Web Serial reliability) without the complexity of @meshtastic/core. Phase 2 adds the differentiating value. Phase 3 polishes the experience.

## Competitive Landscape Summary

| Tool | Flash | Configure | Auth | Event-Specific | Device Picker |
|------|-------|-----------|------|---------------|---------------|
| **flasher.meshtastic.org** | Yes | No | No | No | Yes (all platforms) |
| **defcon.meshtastic.org** | Yes | Pre-baked channels only | No | Partially | Yes |
| **ESP Web Tools** | Yes | WiFi only (Improv) | No | No | Auto-detect chip |
| **ESP Launchpad** | Yes | No | No | No | Chip selector |
| **ESPressoFlash** | Yes | No | No | No | Chip + board selector |
| **Spacehuhn ESPWebTool** | Yes | No | No | No | No (manual) |
| **flash.defcon.run (ours)** | Yes | Full (MQTT, channels, identity, radio) | Yes (OIDC) | Yes (DCR34-tailored) | Yes (ESP32 filtered) |

The gap is clear: no existing tool does flash + full provisioning in one authenticated session. The closest is defcon.meshtastic.org which bakes DEFCONnect channel config into firmware, but it has no per-user MQTT credentials, no identity configuration, and no authentication.

## Sources

- [Meshtastic Web Flasher](https://flasher.meshtastic.org/) -- upstream reference implementation (HIGH confidence)
- [Meshtastic Web Flasher GitHub](https://github.com/meshtastic/web-flasher) -- source code analysis (HIGH confidence)
- [Meshtastic Web Flasher Events](https://github.com/meshtastic/web-flasher-events) -- event-specific fork (MEDIUM confidence, limited differentiation visible)
- [DEF CON Meshtastic Flasher](https://defcon.meshtastic.org/) -- existing DEF CON flasher (MEDIUM confidence, could not fully render JS app)
- [ESP Web Tools](https://esphome.github.io/esp-web-tools/) -- ESPHome's flasher component (HIGH confidence)
- [esptool-js GitHub](https://github.com/espressif/esptool-js) -- Espressif's official JS flash library (HIGH confidence)
- [ESP Launchpad](https://github.com/espressif/esp-launchpad) -- Espressif's configurable browser flasher (MEDIUM confidence)
- [ESPressoFlash](https://espressoflash.com/) -- Multi-chip web flasher (MEDIUM confidence)
- [Spacehuhn ESPWebTool](https://esptool.spacehuhn.com/) -- Simple web flasher (MEDIUM confidence)
- [ESP32 Web Flasher with Config](https://www.hackster.io/lemio/esp32-web-flasher-with-config-faa6de) -- Pre-flash config injection pattern (MEDIUM confidence)
- [Meshtastic BLE Flasher](https://github.com/liamcottle/meshtastic-flasher-ble) -- BLE alternative, documents limitations (HIGH confidence)
- [Lonely Hackers Club Meshtastic Guide](https://lonelyhackers.club/meshtastic/) -- DEF CON community provisioning workflow (MEDIUM confidence)
- [Meshtastic Web Connection Protocols](https://deepwiki.com/meshtastic/web/4.1-connection-protocols) -- @meshtastic/core API patterns (MEDIUM confidence)
- [Meshtastic Web Client Architecture](https://deepwiki.com/meshtastic/meshtastic/4.2-web-client-and-tools) -- Web tool ecosystem overview (MEDIUM confidence)
- [Espressif esptool Troubleshooting](https://docs.espressif.com/projects/esptool/en/latest/esp32/troubleshooting.html) -- Connection failure patterns (HIGH confidence)
