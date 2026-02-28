# Architecture Patterns

**Domain:** Browser-based ESP32 flasher + Meshtastic device configurator
**Researched:** 2026-02-28

## Recommended Architecture

The application is a **wizard-driven single-page app** with three distinct execution phases, each using a different library to control the same physical USB device through the Web Serial API. The critical architectural insight is that **esptool.js and @meshtastic/core cannot share a serial port simultaneously** -- the port must be fully closed and reopened between the flash and configure phases, with a device reboot in between.

```
Browser Tab
+------------------------------------------------------------------+
|                                                                  |
|  React App (Next.js 16 / React 19)                              |
|                                                                  |
|  +------------------+  +------------------+  +-----------------+ |
|  |  Device Picker   |  |  Flash Engine    |  |  Config Engine  | |
|  |                  |  |                  |  |                 | |
|  | hardware-list    |  | esptool.js       |  | @meshtastic/    | |
|  | .json (vendored) |  | ESPLoader +      |  | core +          | |
|  | ESP32 filter     |  | Transport        |  | transport-web-  | |
|  |                  |  |                  |  | serial          | |
|  +--------+---------+  +--------+---------+  +--------+--------+ |
|           |                     |                      |         |
|           v                     v                      v         |
|  +------------------+  +------------------+  +-----------------+ |
|  |  Firmware Store  |  |  Serial Port     |  |  Config API     | |
|  |                  |  |  Manager         |  |                 | |
|  | ZIP fetch/cache  |  |  (shared)        |  | GET /api/config | |
|  | Binary extract   |  |  Open/Close      |  | (server-side)   | |
|  | Address mapping  |  |  lifecycle       |  |                 | |
|  +------------------+  +------------------+  +-----------------+ |
|                                |                                 |
+--------------------------------|------ HTTPS ---------------------+
                                 |           |
                           USB Serial    CloudFront
                                 |           |
                            ESP32 Device   ECS Fargate
                                           (Next.js)
                                              |
                                        auth.defcon.run
                                        (OIDC + RunUser
                                         MQTT creds)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Wizard Shell** | Step orchestration, state machine (pick -> connect -> flash -> configure -> done), error recovery UI | All components below |
| **Device Picker** | Renders filterable device list from vendored `hardware-list.json`, determines `platformioTarget` and chip architecture | Wizard Shell (selected device) |
| **Serial Port Manager** | Owns the `SerialPort` object from `navigator.serial.requestPort()`. Opens/closes port with correct baud rates. Arbitrates access between Flash Engine and Config Engine. | Flash Engine, Config Engine, Web Serial API |
| **Firmware Store** | Fetches firmware ZIP from vendored `/firmware/` path, extracts binaries using fflate/JSZip, maps device `platformioTarget` to specific `.bin` files, resolves flash addresses per architecture | Flash Engine |
| **Flash Engine** | Wraps esptool.js `ESPLoader`. Connects to device in bootloader mode, writes firmware binaries at correct addresses, reports progress, triggers device reset post-flash | Serial Port Manager, Firmware Store, Wizard Shell (progress events) |
| **Config Engine** | Wraps `@meshtastic/core` + `@meshtastic/transport-web-serial`. Connects to freshly-flashed device running Meshtastic firmware, sends AdminMessage protobufs (setConfig, setChannel, setOwner), uses begin/commit transaction pattern | Serial Port Manager, Config API, Wizard Shell (progress events) |
| **Config API** (`/api/config`) | Server-side Next.js route. Authenticates user via OIDC session, reads RunUser from DynamoDB (MQTT creds), combines with environment config (PSK, channels, radio presets), returns complete config payload | auth.defcon.run (OIDC), DynamoDB (RunUser entity) |
| **Browser Gate** | Detects Web Serial API support, gates unsupported browsers before any UI renders | Wizard Shell |

### Data Flow

**Phase 1: Device Selection**

```
hardware-list.json (vendored, static)
       |
       v
  Device Picker component
  - Filters to ESP32-only architectures
  - User browses/filters by name, manufacturer, support level
  - Selection yields: { platformioTarget, architecture, hwModel, displayName }
       |
       v
  Wizard state stores selected device metadata
```

**Phase 2: Connect + Flash**

```
  User clicks "Connect" button
       |
       v
  navigator.serial.requestPort()  <-- requires user gesture
       |
       v
  SerialPort object obtained, stored in Serial Port Manager
       |
       v
  Firmware Store resolves firmware files:
    1. Fetch vendored ZIP: /firmware/firmware-{architecture}-{version}.zip
    2. Extract ZIP in browser (fflate or JSZip -> Uint8Array)
    3. Map platformioTarget to bin files:
       - bootloader.bin         -> offset 0x0000 (varies by arch: 0x0 for S3, 0x1000 for ESP32)
       - partitions.bin         -> offset 0x8000
       - firmware-{target}.bin  -> offset 0x10000 (varies)
       NOTE: Exact offsets vary by ESP32 variant. Reference device-install.sh
             or the web flasher source for per-architecture offset tables.
       |
       v
  Flash Engine:
    1. Create esptool.js Transport(serialPort)
    2. Create ESPLoader({ transport, baudrate: 115200, terminal: progressSink })
    3. await espLoader.main()  -- connects, detects chip, uploads stub
    4. await espLoader.writeFlash({
         fileArray: [
           { address: 0x0000, data: bootloaderBytes },
           { address: 0x8000, data: partitionsBytes },
           { address: 0x10000, data: firmwareBytes },
         ],
         flashSize: "keep",
         flashMode: "keep",
         flashFreq: "keep",
         eraseAll: true,       // clean flash for fresh install
         compress: true,
         reportProgress: (fileIndex, written, total) => updateUI(...)
       })
    5. await espLoader.softReset()  -- reboot into flashed firmware
    6. transport.disconnect()        -- release serial port
       |
       v
  Serial port is now CLOSED. Device is rebooting into Meshtastic firmware.
```

**Phase 3: Configure (the critical handoff)**

```
  WAIT: Device needs ~3-5 seconds to boot Meshtastic firmware after flash.
  The serial port object from requestPort() is REUSABLE -- same object,
  new open() call with different baud rate.
       |
       v
  Config API fetch (parallel with wait):
    GET /api/config (authenticated)
    Returns: { mqtt, channels, identity, radio }
    PSK and MQTT password are in this payload -- never in client bundle.
       |
       v
  Config Engine:
    1. Reopen serial port at 115200 baud (Meshtastic default)
       - Same SerialPort object, call port.open({ baudRate: 115200 })
    2. Create @meshtastic/core MeshDevice with transport-web-serial transport
    3. Wait for device to complete boot (listen for initial config packets)
    4. Send AdminMessage sequence using begin/commit transaction:
       a. beginEditSettings
       b. setOwner({ longName, shortName })
       c. setConfig({ lora: { region: US, modemPreset, hopLimit } })
       d. setConfig({ mqtt: { enabled: true, address, username, password, tls, root } })
       e. setChannel(0, { name: "DCR34", psk, role: PRIMARY })
       f. setChannel(1, { name: "defcon", psk, role: SECONDARY })
       g. commitEditSettings  -- device persists to flash and reboots
    5. Disconnect transport
    6. Close serial port
       |
       v
  Wizard advances to "Done" step with success confirmation
```

## The Critical Flash-to-Configure Transition

**Confidence: MEDIUM** (verified pattern from Web Serial spec + esptool.js Transport API + Meshtastic community patterns, but not tested end-to-end in this exact React stack)

This is the single most architecturally significant challenge. Here is what happens:

### Serial Port Lifecycle

1. **User grants port access** via `navigator.serial.requestPort()` -- this returns a `SerialPort` object. The user gesture requirement means we get ONE port object and must reuse it.

2. **esptool.js takes the port** -- creates a `Transport(serialPort)` which calls `port.open({ baudRate: 115200 })`, then may change baud to 921600 for faster flashing (by closing and reopening).

3. **esptool.js releases the port** -- after `writeFlash()` completes and `softReset()` triggers device reboot, call `transport.disconnect()` which runs `port.close()`.

4. **Device reboots** -- the ESP32 leaves bootloader mode, boots the newly flashed Meshtastic firmware. This takes 3-5 seconds. During this time the port is closed on our side and the device is in transition.

5. **Reopen port for configuration** -- call `port.open({ baudRate: 115200 })` on the same `SerialPort` object. This works because `SerialPort` objects survive close/reopen cycles. The Web Serial spec explicitly supports this pattern.

6. **@meshtastic/core takes the port** -- creates its transport layer using `@meshtastic/transport-web-serial`, connects, waits for the device to announce itself, then sends configuration.

### Why This Works

- The `SerialPort` object persists in JavaScript memory after `close()`. You can call `open()` again.
- The `connected` property on `SerialPort` indicates physical device presence (USB plugged in) independent of the logical open/close state.
- The device reboots via DTR/RTS signals from esptool.js `softReset()`, then re-enumerates on the same USB port.

### What Can Go Wrong

- **Device takes too long to boot**: Need retry logic with exponential backoff on the reopen.
- **Device enumerates on different USB endpoint after flash**: Some ESP32-S2/S3 devices switch between USB-OTG and USB-JTAG after firmware changes. Mitigation: detect chip type during flash step and warn user if manual reconnect may be needed.
- **User unplugs cable during transition**: Detect via `SerialPort.disconnect` event, show recovery UI.
- **@meshtastic/core expects device in specific state**: Freshly flashed device has no config -- the library must handle the "factory reset" initial state gracefully.

### Recommended Implementation

```typescript
// Serial Port Manager -- owns the port across both phases
class SerialPortManager {
  private port: SerialPort | null = null;

  async requestPort(): Promise<SerialPort> {
    this.port = await navigator.serial.requestPort({
      filters: [
        // Common ESP32 USB-UART chips
        { usbVendorId: 0x10C4 }, // Silicon Labs CP2102/CP2104
        { usbVendorId: 0x1A86 }, // QinHeng CH340/CH9102
        { usbVendorId: 0x0403 }, // FTDI
        { usbVendorId: 0x303A }, // Espressif native USB
      ]
    });
    return this.port;
  }

  getPort(): SerialPort | null {
    return this.port;
  }

  get isConnected(): boolean {
    return this.port?.connected ?? false;
  }

  async waitForReboot(timeoutMs = 8000): Promise<void> {
    // After flash, wait for device to be ready
    // Poll port.connected + attempt open with backoff
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.port?.connected) {
        try {
          await this.port.open({ baudRate: 115200 });
          return; // success
        } catch {
          await delay(500); // device not ready yet
        }
      } else {
        await delay(500);
      }
    }
    throw new Error("Device did not respond after flash");
  }
}
```

## Patterns to Follow

### Pattern 1: Wizard State Machine

**What:** Model the entire flow as a finite state machine with explicit states and transitions.
**Why:** The flash + configure workflow has strict ordering requirements. A state machine prevents invalid transitions (e.g., trying to configure before flash completes) and makes error recovery explicit.
**When:** Core wizard orchestration.

```typescript
type WizardState =
  | { step: "browser-check" }
  | { step: "device-select"; devices: Device[] }
  | { step: "connect"; selectedDevice: Device }
  | { step: "flash"; port: SerialPort; device: Device; progress: FlashProgress }
  | { step: "flash-complete"; port: SerialPort; device: Device }
  | { step: "configure"; port: SerialPort; config: DeviceConfig; progress: ConfigProgress }
  | { step: "done"; device: Device }
  | { step: "error"; error: WizardError; recoverTo: WizardState["step"] };

type WizardAction =
  | { type: "BROWSER_OK" }
  | { type: "DEVICE_SELECTED"; device: Device }
  | { type: "PORT_CONNECTED"; port: SerialPort }
  | { type: "FLASH_PROGRESS"; fileIndex: number; written: number; total: number }
  | { type: "FLASH_COMPLETE" }
  | { type: "CONFIG_PROGRESS"; step: string; current: number; total: number }
  | { type: "CONFIG_COMPLETE" }
  | { type: "ERROR"; error: WizardError }
  | { type: "RETRY" };
```

### Pattern 2: Progress Event Streaming

**What:** Both esptool.js and @meshtastic/core provide callback-based progress. Wrap these in a unified progress reporting interface.
**Why:** Consistent UI updates across both flash and configure phases.
**When:** During flash and configure steps.

```typescript
interface ProgressEvent {
  phase: "flash" | "configure";
  step: string;           // "erasing" | "writing-bootloader" | "writing-firmware" | "setting-mqtt" | etc.
  current: number;        // bytes written or config step index
  total: number;          // total bytes or total config steps
  message: string;        // human-readable status
}

// esptool.js reportProgress adapter
function flashProgressAdapter(
  dispatch: (event: ProgressEvent) => void
): (fileIndex: number, written: number, total: number) => void {
  const fileNames = ["bootloader", "partitions", "firmware"];
  return (fileIndex, written, total) => {
    dispatch({
      phase: "flash",
      step: `writing-${fileNames[fileIndex]}`,
      current: written,
      total,
      message: `Writing ${fileNames[fileIndex]}... ${Math.round((written / total) * 100)}%`,
    });
  };
}
```

### Pattern 3: Server-Side Secret Assembly

**What:** The `/api/config` route assembles the full device configuration server-side. PSK, MQTT credentials, and channel config never appear in client JavaScript bundles.
**Why:** Security. The client only receives the assembled config object after authentication, for immediate use, then discards it.
**When:** Config API route implementation.

```typescript
// /api/config/route.ts (server-side only)
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runUser = await getRunUser(session.user.id); // DynamoDB via ElectroDB

  return NextResponse.json({
    mqtt: {
      server: config.meshtastic.mqttServer,    // env: MQTT_SERVER
      port: config.meshtastic.mqttPort,        // env: MQTT_PORT
      username: runUser.mqttUsername,           // from DynamoDB
      password: runUser.mqttPassword,          // from DynamoDB
      tls: true,
      root: config.meshtastic.mqttRoot,        // env: MQTT_ROOT
    },
    channels: JSON.parse(config.meshtastic.channels), // env: MESHTASTIC_CHANNELS (JSON)
    identity: {
      longName: runUser.displayName || session.user.name,
      shortName: (runUser.shortName || session.user.name?.slice(0, 4) || "MESH").toUpperCase(),
    },
    radio: {
      region: config.meshtastic.region,        // env: MESHTASTIC_REGION
      modemPreset: config.meshtastic.modemPreset,
      hopLimit: config.meshtastic.hopLimit,
    },
  });
}
```

### Pattern 4: Vendored Firmware as Static Assets

**What:** Firmware ZIPs are built into the Docker image and served as static assets under `/firmware/`. No runtime GitHub fetches.
**Why:** Zero external dependencies at event time. GitHub rate limits, outages, or network issues cannot break the flasher.
**When:** Dockerfile build step.

```dockerfile
# In Dockerfile.webapp
# Download and vendor firmware during Docker build
ARG MESHTASTIC_VERSION=2.5.6.abcdef
RUN mkdir -p /app/public/firmware && \
    curl -fsSL "https://github.com/meshtastic/firmware/releases/download/v${MESHTASTIC_VERSION}/firmware-esp32-${MESHTASTIC_VERSION}.zip" \
      -o /app/public/firmware/firmware-esp32-${MESHTASTIC_VERSION}.zip && \
    curl -fsSL "https://github.com/meshtastic/firmware/releases/download/v${MESHTASTIC_VERSION}/firmware-esp32s3-${MESHTASTIC_VERSION}.zip" \
      -o /app/public/firmware/firmware-esp32s3-${MESHTASTIC_VERSION}.zip && \
    curl -fsSL "https://github.com/meshtastic/firmware/releases/download/v${MESHTASTIC_VERSION}/firmware-esp32c3-${MESHTASTIC_VERSION}.zip" \
      -o /app/public/firmware/firmware-esp32c3-${MESHTASTIC_VERSION}.zip && \
    curl -fsSL "https://github.com/meshtastic/firmware/releases/download/v${MESHTASTIC_VERSION}/firmware-esp32c6-${MESHTASTIC_VERSION}.zip" \
      -o /app/public/firmware/firmware-esp32c6-${MESHTASTIC_VERSION}.zip
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running esptool.js in a Web Worker

**What:** Moving the flash operation to a Web Worker for "performance."
**Why bad:** Web Serial API is only accessible from the main thread (it requires user gesture for `requestPort()` and the `SerialPort` object is not transferable to workers). Attempting to use Web Workers with Web Serial will fail at the API level.
**Instead:** Run esptool.js on the main thread. The `writeFlash` operation is I/O-bound (serial communication), not CPU-bound, so it does not block the UI thread significantly. Use `requestAnimationFrame` or micro-task scheduling for progress updates.

### Anti-Pattern 2: Two Serial Port Requests

**What:** Calling `navigator.serial.requestPort()` twice -- once for flash, once for configure.
**Why bad:** Each call shows the browser's port picker dialog, requiring a second user gesture. Users must pick the same port twice. If they pick wrong, configuration goes to the wrong device. Confusing UX.
**Instead:** Request the port once during the "Connect" step. Store the `SerialPort` object. Reuse it across flash and configure phases by closing and reopening.

### Anti-Pattern 3: Fetching Firmware at Flash Time

**What:** Downloading firmware from GitHub when the user clicks "Flash."
**Why bad:** At DEF CON, network is unreliable. GitHub could be rate-limited. Adds latency to the flash step. Creates a runtime external dependency for a safety-critical operation.
**Instead:** Vendor firmware into the Docker image. Serve from the app's own static assets. The only network call during the wizard should be the authenticated `/api/config` fetch.

### Anti-Pattern 4: Storing Secrets in Client State

**What:** Fetching config at app load and storing PSK/MQTT credentials in React state or context for the duration of the session.
**Why bad:** Secrets persist in memory longer than needed. React DevTools can inspect them. Browser extensions can read them.
**Instead:** Fetch `/api/config` only when entering the configure step. Use the response immediately to push config to the device. Do not store it in persistent React state -- let it be garbage collected after the configure step completes.

### Anti-Pattern 5: Sharing Transport Objects Between Libraries

**What:** Trying to pass esptool.js's `Transport` object to `@meshtastic/core` or vice versa.
**Why bad:** These are completely different transport implementations with different protocols (SLIP framing for esptool vs. raw protobuf for Meshtastic). They are not interchangeable.
**Instead:** Share the underlying `SerialPort` object only. Each library creates its own transport wrapper around the port.

## Suggested Build Order

Based on component dependencies, build in this order:

```
Phase 1: Foundation (no serial, no device interaction)
  1. Next.js app scaffold (matches monorepo patterns)
  2. OIDC auth integration (copy from run.gpx)
  3. Browser capability gate
  4. /api/config route (stub values, real auth)
  5. Device Picker (static JSON, no serial)

Phase 2: Flash Engine (serial interaction begins)
  6. Serial Port Manager
  7. Firmware Store (ZIP fetch + extraction)
  8. Flash Engine (esptool.js integration)
  9. Flash progress UI

Phase 3: Config Engine (the hard part)
  10. Flash-to-configure handoff (port close/reopen/wait)
  11. Config Engine (@meshtastic/core integration)
  12. Config progress UI
  13. Full wizard integration

Phase 4: Polish + Deploy
  14. Error recovery flows
  15. Firmware vendoring in Docker
  16. Terragrunt service definition
  17. CloudFront + DNS
```

**Dependency chain:** Steps 1-5 can be built with zero hardware. Steps 6-9 need an ESP32 device for testing. Steps 10-13 are the highest-risk integration work. Steps 14-17 follow existing monorepo patterns.

## Scalability Considerations

This is a single-user-at-a-time tool (one user, one USB cable, one device). Scalability concerns are minimal and different from typical web apps.

| Concern | At Event (100s of users) | Mitigation |
|---------|--------------------------|------------|
| `/api/config` load | Low -- each user makes 1 request per flash session | Standard ECS autoscaling |
| Firmware download bandwidth | Users download ~10MB ZIP each | CloudFront caches static assets; firmware ZIPs are cache-friendly |
| DynamoDB reads for MQTT creds | 1 read per flash session | Existing RunUser table capacity is sufficient |
| Concurrent serial connections | N/A -- serial is local to each browser tab | No server-side concern |
| Auth token refresh during long flash | Flash can take 2-3 minutes | Ensure session timeout > 10 minutes |

## Sources

- [esptool-js GitHub](https://github.com/espressif/esptool-js) -- ESPLoader, Transport, FlashOptions API (HIGH confidence)
- [esptool-js API docs](https://espressif.github.io/esptool-js/docs/classes/ESPLoader.html) -- ESPLoader class methods and FlashOptions interface (HIGH confidence)
- [esptool-js DeepWiki](https://deepwiki.com/espressif/esptool-js) -- Architecture: connection flow, SLIP protocol, Transport layer, writeFlash sequence (MEDIUM confidence)
- [Meshtastic web monorepo](https://github.com/meshtastic/web) -- @meshtastic/core + transport-web-serial package structure (HIGH confidence)
- [Meshtastic web-flasher](https://github.com/meshtastic/web-flasher) -- Upstream flasher architecture (Nuxt/Vue, reference implementation) (MEDIUM confidence)
- [Meshtastic web-flasher-events](https://github.com/meshtastic/web-flasher-events) -- Events-specific fork (LOW confidence -- limited docs on differences)
- [Meshtastic Client API](https://meshtastic.org/docs/development/device/client-api/) -- ToRadio/FromRadio protocol, connection handshake (HIGH confidence)
- [Meshtastic AdminMessage architecture](https://deepwiki.com/meshtastic/firmware/8.2-ui-modules-(canned-messages-and-notifications)) -- Admin message types, 4-tier security, begin/commit transactions (MEDIUM confidence)
- [Meshtastic MQTT config protobuf](https://meshtastic.org/docs/configuration/module/mqtt/) -- MQTTConfig fields: server, username, password, tls, root (HIGH confidence)
- [Meshtastic Channel protobuf](https://deepwiki.com/meshtastic/protobufs/3.4-channel-configuration) -- Channel, ChannelSettings, Role enum, PSK format (HIGH confidence)
- [Web Serial API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) -- Port lifecycle, connect/disconnect events, open/close/reopen (HIGH confidence)
- [Web Serial API spec (WICG)](https://wicg.github.io/serial/) -- SerialPort reuse after close, connected property (HIGH confidence)
- [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial) -- getPorts(), requestPort(), stream management (HIGH confidence)
- [WICG/serial auto-reconnect issue](https://github.com/WICG/serial/issues/156) -- Reconnection patterns and guidance (MEDIUM confidence)
- [@meshtastic/core on JSR](https://jsr.io/@meshtastic/core) -- MeshDevice class, v2.6.7 (MEDIUM confidence -- limited API detail visible)
- [esptool-js npm](https://www.npmjs.com/package/esptool-js) -- v0.5.7 latest (HIGH confidence)

---

*Architecture research: 2026-02-28*
