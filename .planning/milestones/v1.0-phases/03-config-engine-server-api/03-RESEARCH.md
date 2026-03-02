# Phase 3: Config Engine + Server API - Research

**Researched:** 2026-02-28
**Domain:** Meshtastic device configuration via @meshtastic/core over Web Serial + authenticated server API for secrets
**Confidence:** HIGH

## Summary

Phase 3 connects two major subsystems: (1) a server-side `/api/config` endpoint that assembles per-user device configuration from RunUser entities and environment-driven secrets, and (2) a client-side config engine that pushes MQTT, channel, identity, and radio settings to the device via `@meshtastic/core` over Web Serial. The highest technical risk is the serial port handoff between Phase 2's esptool.js (which puts the device in bootloader mode at 115200 baud) and Phase 3's `@meshtastic/core` (which needs the device running Meshtastic firmware at 115200 baud on the application serial interface). After flash, the device reboots into newly-flashed firmware -- the serial port must be released by esptool.js, then reopened by `@meshtastic/core`'s `TransportWebSerial`.

The `@meshtastic/core` library (v2.6.7) provides a clean API: `setConfig()` automatically calls `beginEditSettings()` on first invocation, and `commitEditSettings()` finalizes the transaction. The config sequence is: MQTT module config, channel settings (PRIMARY + SECONDARY), owner identity (long/short name), and LoRa radio config. All protobuf types are available via `@meshtastic/protobufs`.

**Primary recommendation:** Use `@meshtastic/core` + `@meshtastic/transport-web-serial` for device configuration. Retrieve the serial port from `navigator.serial.getPorts()` after releasing the esptool.js transport, add a 3-5 second delay for device reboot, then create a new `TransportWebSerial` instance. The `/api/config` endpoint should directly access DynamoDB via ElectroDB (same pattern as run.human) to read RunUser MQTT credentials and identity, avoiding cross-service API calls.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Config Push Progress UX: Reuse FlashPipeline staged pipeline pattern -- four stages: MQTT, Channels, Identity, Radio, each with inline checkmark on completion
- Real-time speed -- no artificial delays. Push each config as fast as the device accepts it
- Show category + summary value for each stage (e.g., "MQTT: mqtt.defcon.run" -> "MQTT: mqtt.defcon.run checkmark"). No secrets shown (no PSK/password)
- Fail entire config on any step failure -- uses transactional edit (beginEditSettings/commitEditSettings) for atomic apply. Partial config is rolled back, user retries from scratch
- Done Screen: Quick celebration + info: brief teal glow/checkmark moment, then practical summary
- Full config summary on Done: long name, short name, MQTT server, channels configured, radio region/preset
- Next steps on Done: 1) Register your radio on run.defcon.run (link out) 2) Download Meshtastic app to monitor your device 3) Disconnect USB
- "Flash Another Device" button -- resets the wizard for provisioning multiple boards at the DEF CON booth
- Hardcoded stub values in dev mode (NODE_ENV !== 'production') -- zero env var setup needed to run locally. Production reads env vars
- Two channels: Primary "DCR34" with event PSK, Secondary "defcon" bridge channel with separate PSK
- All config values env-driven in production with stub defaults for dev

### Claude's Discretion
- @meshtastic/core integration approach (transport setup, protobuf config format)
- Post-flash reconnection strategy (port reuse, polling, timeout values)
- MQTT credential generation mechanism
- Identity source (session name vs RunUser entity lookup)
- /api/config response structure and error handling
- Config transaction implementation details (beginEditSettings/commitEditSettings)
- Reconnection fallback behavior

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | After flash, app reconnects to device via @meshtastic/core over Web Serial (handles reboot delay, retry logic) | TransportWebSerial.createFromPort() with getPorts() port reuse; 3-5s reboot delay; MeshDevice.configure() for handshake |
| CONF-02 | App pushes MQTT config to device: server, port, TLS, per-user credentials from RunUser entity | MeshDevice.setConfig() with ModuleConfig MQTTConfig protobuf; fields: address, username, password, tls_enabled, root |
| CONF-03 | App pushes channel config: DCR34 primary channel with PSK, bridge channels | MeshDevice.setChannel() with Channel protobuf; PRIMARY role index 0, SECONDARY role index 1; PSK as bytes (16 or 32) |
| CONF-04 | App pushes identity config: long name and short name from authenticated user's DCR34 profile | MeshDevice.setOwner() with User protobuf; longName (string), shortName (4 chars max) |
| CONF-05 | App pushes radio config: LoRa region (US), modem preset, hop limit | MeshDevice.setConfig() with Config LoRaConfig; region=US, modemPreset=LONG_FAST, hopLimit=3 |
| CONF-06 | Configuration push uses transactional edit (beginEditSettings/commitEditSettings) for atomic apply | setConfig() auto-calls beginEditSettings(); explicit commitEditSettings() after all configs pushed |
| CONF-07 | Configuration progress is displayed with per-step status | Reuse FlashPipeline pattern with 4 stages; StageStatus type (pending/active/complete/error) |
| SRVR-01 | GET /api/config returns authenticated user's device config payload | Next.js API route using auth() session check + ElectroDB RunUser query for MQTT creds + env vars for channels/radio |
| SRVR-02 | PSK, MQTT credentials, channel config never exposed in client-side JS bundles -- served via authenticated API only | Server-side only route.ts; fetch from client via useEffect/fetch; no imports of secrets in client components |
| SRVR-03 | All TBD config values are environment/config-driven with stub defaults | Frozen config object pattern (see existing config/firmware.ts, config/site.ts); dev stubs, prod from env |
| WZRD-04 | Done screen shows success confirmation with device identity and next steps | DoneStep component with teal glow, config summary, next-steps list, "Flash Another Device" button |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @meshtastic/core | 2.6.7 | MeshDevice API for device configuration | Official Meshtastic JS library; provides setConfig, setChannel, setOwner, transaction management |
| @meshtastic/transport-web-serial | 0.2.5 | Web Serial transport layer for @meshtastic/core | Official transport; wraps navigator.serial with proper stream handling |
| @meshtastic/protobufs | 2.7.18 | Protobuf type definitions (Config, Channel, User, ModuleConfig) | Required by @meshtastic/core for typed config objects |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electrodb | (match run.human) | DynamoDB entity framework for RunUser access | /api/config route needs to read RunUser.mqttUsername, mqttPassword, displayName |
| @aws-sdk/client-dynamodb | (match run.human) | AWS DynamoDB client | Required by ElectroDB for database access |
| @aws-sdk/lib-dynamodb | (match run.human) | DynamoDB Document client wrapper | Required by ElectroDB for marshalling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct DynamoDB access in flash app | Call run.human API for user data | Cross-service call adds latency, requires run.human to be running in dev, couples flash to run.human availability. Direct DynamoDB access is simpler and follows the monorepo pattern where services share the same database. |
| @meshtastic/core | Raw protobuf + serial writes | Would require reimplementing the entire Meshtastic protocol. The official library handles framing, checksums, retries, and the AdminMessage transaction pattern. |
| navigator.serial.getPorts() for port reuse | navigator.serial.requestPort() for new port prompt | getPorts() avoids showing the browser port picker again and reuses the already-granted permission. requestPort() would require another user gesture. |

**Installation:**
```bash
cd apps/run.flash/webapp
npm install @meshtastic/core @meshtastic/transport-web-serial
npm install electrodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   └── api/
│       └── config/
│           └── route.ts          # GET /api/config - authenticated config endpoint
├── components/
│   ├── configure/
│   │   ├── configure-step.tsx    # Configure wizard step (replaces PlaceholderStep)
│   │   └── config-pipeline.tsx   # 4-stage pipeline (MQTT/Channels/Identity/Radio)
│   └── done/
│       └── done-step.tsx         # Done wizard step (replaces PlaceholderStep)
├── config/
│   └── meshtastic.ts             # Meshtastic config defaults (env-driven + dev stubs)
├── hooks/
│   └── use-configure.ts          # Config push orchestration hook
├── entities/
│   ├── client.ts                 # ElectroDB/DynamoDB client (copied from run.human pattern)
│   └── run-user.ts               # RunUser entity (read-only subset from run.human)
├── lib/
│   └── meshtastic.ts             # @meshtastic/core wrapper (transport, connection, config push)
└── types/
    └── config.ts                 # Config payload types, config stage types
```

### Pattern 1: Serial Port Handoff (Flash -> Configure)
**What:** After esptool.js flashes firmware, the device reboots. The serial port must be released by esptool.js Transport, then reopened by @meshtastic/core TransportWebSerial.
**When to use:** Transitioning from flash step to configure step.
**Example:**
```typescript
// Source: Web Serial API spec + @meshtastic/transport-web-serial source
// Step 1: Release esptool.js transport (already happens in flash step)
await espToolTransport.disconnect(); // Closes serial port

// Step 2: Wait for device reboot (freshly flashed firmware boots)
await new Promise(resolve => setTimeout(resolve, 4000)); // 3-5s for boot

// Step 3: Get the same serial port without new user gesture
const ports = await navigator.serial.getPorts(); // Returns previously granted ports
const port = ports[0]; // The port we were using

// Step 4: Create @meshtastic/core transport from existing port
const transport = await TransportWebSerial.createFromPort(port);

// Step 5: Create MeshDevice and configure (request initial config from device)
const device = new MeshDevice(transport);
await device.configure(); // Sends wantConfigId, device responds with its config
```

### Pattern 2: Atomic Configuration Transaction
**What:** All config changes are wrapped in beginEditSettings/commitEditSettings for atomic apply. setConfig() auto-calls beginEditSettings if needed.
**When to use:** Pushing MQTT, channels, identity, and radio config.
**Example:**
```typescript
// Source: @meshtastic/core meshDevice.ts source analysis
// setConfig() automatically calls beginEditSettings() on first call
// (tracks via pendingSettingsChanges boolean)

// 1. MQTT Config
await device.setConfig(new Protobuf.Config.Config({
  payloadVariant: {
    case: "mqtt", // This is actually ModuleConfig, not Config
    value: { enabled: true, address: "mqtt.defcon.run", ... }
  }
}));

// Note: MQTT is a ModuleConfig, not a Config. Use setModuleConfig for MQTT.
// 2. Channels
await device.setChannel(new Protobuf.Channel.Channel({
  index: 0,
  role: Protobuf.Channel.Channel_Role.PRIMARY,
  settings: { name: "DCR34", psk: pskBytes }
}));

// 3. Owner/Identity
await device.setOwner(new Protobuf.Mesh.User({
  longName: "Runner Alice",
  shortName: "ALIC"
}));

// 4. LoRa Radio
await device.setConfig(new Protobuf.Config.Config({
  payloadVariant: {
    case: "lora",
    value: { region: RegionCode.US, modemPreset: ModemPreset.LONG_FAST, hopLimit: 3 }
  }
}));

// 5. Commit all changes atomically
await device.commitEditSettings();
```

### Pattern 3: Server-Side Config Assembly
**What:** The /api/config route assembles a complete device config payload from multiple sources: RunUser entity (MQTT creds, identity), environment variables (MQTT server, channel PSKs, radio presets), and defaults.
**When to use:** GET /api/config endpoint.
**Example:**
```typescript
// Source: Established run.human API route pattern
import { auth } from "@auth";
import { getRunUser } from "@/entities/run-user";
import { meshtasticConfig } from "@/config/meshtastic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getRunUser(session.user.id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    mqtt: {
      server: meshtasticConfig.mqtt.server,
      port: meshtasticConfig.mqtt.port,
      username: user.mqttUsername,
      password: user.mqttPassword,
      tls: meshtasticConfig.mqtt.tls,
      root: meshtasticConfig.mqtt.root,
    },
    channels: meshtasticConfig.channels,
    identity: {
      longName: user.displayName || `DCR34_${session.user.id.slice(0, 4)}`,
      shortName: (user.displayName || session.user.id).slice(0, 4).toUpperCase(),
    },
    radio: meshtasticConfig.radio,
  });
}
```

### Pattern 4: Environment-Driven Config with Dev Stubs
**What:** Frozen config object with dev-mode stubs and production env vars.
**When to use:** All Meshtastic config values (MQTT server, channel PSKs, radio presets).
**Example:**
```typescript
// Source: Existing apps/run.flash/webapp/src/config/firmware.ts pattern
const isDev = process.env.NODE_ENV !== "production";

export const meshtasticConfig = Object.freeze({
  mqtt: {
    server: process.env.MQTT_SERVER || "mqtt.defcon.run",
    port: Number(process.env.MQTT_PORT) || 8883,
    tls: process.env.MQTT_TLS !== "false",
    root: process.env.MQTT_ROOT || "dcr34",
  },
  channels: [
    {
      name: "DCR34",
      psk: process.env.DCR34_PRIMARY_PSK || "AAAAAAAAAAAAAAAAAAAAAA==", // 16-byte stub
      role: "PRIMARY" as const,
    },
    {
      name: "defcon",
      psk: process.env.DCR34_BRIDGE_PSK || "BBBBBBBBBBBBBBBBBBBBBB==", // 16-byte stub
      role: "SECONDARY" as const,
    },
  ],
  radio: {
    region: "US" as const,
    modemPreset: process.env.LORA_MODEM_PRESET || "LONG_FAST",
    hopLimit: Number(process.env.LORA_HOP_LIMIT) || 3,
  },
});
```

### Anti-Patterns to Avoid
- **Importing secrets in client components:** PSK, MQTT password, channel config must NEVER be imported in files used by the browser. Only the API route (server-side) should access them.
- **Storing MeshDevice in React state:** Like ESPLoader, MeshDevice is a mutable class instance with internal state. Store in useRef, not useState.
- **Skipping commitEditSettings:** If setConfig auto-calls beginEditSettings but you never commit, the device holds uncommitted changes that are lost on reboot.
- **Hardcoding PSK as string:** PSK must be provided as bytes (Uint8Array). The base64 string from the config API must be decoded to bytes before passing to setChannel.
- **Calling requestPort() for reconnect:** After flash, the user has already granted port access. Use getPorts() to retrieve the already-authorized port without showing the picker dialog again.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Meshtastic protobuf serialization | Custom protobuf encoder | @meshtastic/core + @meshtastic/protobufs | Protocol framing, checksums, packet sequencing are complex and version-specific |
| Serial port stream management | Raw ReadableStream/WritableStream handling | TransportWebSerial from @meshtastic/transport-web-serial | Handles stream piping, abort controllers, reconnection, status events |
| Config transaction semantics | Manual begin/commit tracking | MeshDevice.setConfig() (auto-begins) + commitEditSettings() | Library tracks pendingSettingsChanges state internally |
| DynamoDB entity modeling | Raw DynamoDB SDK calls | ElectroDB entity (same as run.human) | Consistent with monorepo pattern; handles marshalling, indexes, type safety |
| PSK encoding/decoding | Custom base64-to-bytes | Buffer.from(psk, 'base64') server-side, atob() + Uint8Array client-side | Standard JS APIs handle this correctly |

**Key insight:** The @meshtastic/core library encapsulates the entire Meshtastic client protocol. Attempting to send raw protobuf packets over serial would require reimplementing packet framing (start bytes, length encoding, CRC), the AdminMessage routing, the config transaction state machine, and device status tracking. The library does all of this.

## Common Pitfalls

### Pitfall 1: Serial Port Not Released After Flash
**What goes wrong:** esptool.js Transport holds the serial port open. Attempting to create a new TransportWebSerial on the same port fails with "port is already open" or "port is already in use."
**Why it happens:** esptool.js Transport.disconnect() may not fully release the port, or the disconnect is async and hasn't completed.
**How to avoid:** Explicitly call `transport.disconnect()` on the esptool.js transport, then `await port.close()` on the underlying SerialPort if the transport doesn't do it. Wait for the close to complete before attempting to reopen.
**Warning signs:** "Failed to execute 'open' on 'SerialPort': The port is already open" error in console.

### Pitfall 2: Device Not Ready After Reboot
**What goes wrong:** After flash, the ESP32 reboots into new firmware. The Meshtastic firmware needs time to initialize before it accepts serial commands. Connecting too early results in timeout or garbled data.
**Why it happens:** Fresh firmware boot takes 2-5 seconds. USB CDC devices may also briefly disconnect/reconnect at the OS level during reboot.
**How to avoid:** Add a 3-5 second delay after flash completes before attempting @meshtastic/core connection. Use retry logic with exponential backoff (try every 1s up to 15s total).
**Warning signs:** Connection timeouts, "Device not responding" errors, stream read errors.

### Pitfall 3: PSK Format Mismatch
**What goes wrong:** Channel PSK must be exactly 0, 16, or 32 bytes. Passing a base64 string directly (instead of decoded bytes) or passing the wrong length causes the device to reject the channel config.
**Why it happens:** The API returns PSK as base64 string, but the protobuf Channel.settings.psk field expects `Uint8Array` (bytes).
**How to avoid:** Decode base64 to bytes on the client side. Validate byte length is 0, 16, or 32 before sending.
**Warning signs:** Device silently ignores channel config, or returns an error on setChannel.

### Pitfall 4: Short Name Length Limit
**What goes wrong:** Meshtastic short name must be 1-4 characters. Longer values are silently truncated or cause errors.
**Why it happens:** The protobuf User.short_name field has a 4-byte limit enforced by firmware.
**How to avoid:** Truncate to 4 characters and uppercase before sending. Use first 4 chars of display name or a derived abbreviation.
**Warning signs:** Short name appears truncated or missing on the device after configuration.

### Pitfall 5: MQTT Config is ModuleConfig, Not Config
**What goes wrong:** MQTT settings are under `ModuleConfig`, not `Config`. Calling `setConfig()` with MQTT payload sends the wrong message type.
**Why it happens:** Meshtastic separates "core config" (device, LoRa, power, etc.) from "module config" (MQTT, serial, telemetry, etc.). They use different AdminMessage variants.
**How to avoid:** Check the @meshtastic/core source -- MQTT likely needs `setModuleConfig()` rather than `setConfig()`. Verify with the actual API.
**Warning signs:** MQTT config not applied; device still uses default MQTT settings after pushing config.

### Pitfall 6: Secrets in Client Bundle
**What goes wrong:** If meshtastic config (with PSKs, MQTT creds) is imported in a client component, Next.js bundles it into client-side JavaScript, exposing secrets.
**Why it happens:** Next.js tree-shakes but includes anything imported in 'use client' files. Config files with `process.env` references get bundled with placeholder values or actual values depending on NEXT_PUBLIC_ prefix.
**How to avoid:** Keep all secret-bearing config in server-side only files (API routes, server components). Client fetches secrets via authenticated `/api/config` call. Never use NEXT_PUBLIC_ for secrets.
**Warning signs:** PSK or MQTT password visible in browser DevTools Network tab or Sources panel as part of JS bundle.

## Code Examples

Verified patterns from official sources:

### Creating TransportWebSerial from Existing Port
```typescript
// Source: @meshtastic/transport-web-serial source analysis
import { TransportWebSerial } from "@meshtastic/transport-web-serial";

// Get previously-granted port (no user gesture needed)
const ports = await navigator.serial.getPorts();
if (ports.length === 0) throw new Error("No serial port available");

// createFromPort opens the port if not already open
const transport = await TransportWebSerial.createFromPort(ports[0]);
```

### Creating MeshDevice and Initiating Config
```typescript
// Source: @meshtastic/core source + examples analysis
import { MeshDevice } from "@meshtastic/core";

const device = new MeshDevice(transport);

// configure() sends wantConfigId to device, triggering config dump
// Device responds with its current config via events
await device.configure();

// Subscribe to events to know when device is ready
device.events.onDeviceStatus.subscribe((status) => {
  if (status === DeviceStatusEnum.DeviceConfigured) {
    // Device is ready to receive config changes
  }
});
```

### Setting Channel Config
```typescript
// Source: @meshtastic/protobufs Channel definition + MeshDevice.setChannel()
import { Protobuf } from "@meshtastic/core";

// Decode base64 PSK to bytes
const pskBytes = Uint8Array.from(atob(pskBase64), c => c.charCodeAt(0));

await device.setChannel(
  Protobuf.Channel.create({
    index: 0,
    role: Protobuf.Channel.Channel_Role.PRIMARY,
    settings: {
      name: "DCR34",
      psk: pskBytes,
      uplinkEnabled: false,
      downlinkEnabled: false,
    },
  })
);
```

### Setting Owner (Identity)
```typescript
// Source: @meshtastic/core MeshDevice.setOwner()
await device.setOwner(
  Protobuf.Mesh.User.create({
    longName: "Runner Alice",
    shortName: "ALIC",
  })
);
```

### Setting LoRa Config
```typescript
// Source: @meshtastic/protobufs Config.LoRaConfig
await device.setConfig(
  Protobuf.Config.Config.create({
    payloadVariant: {
      case: "lora",
      value: {
        region: Protobuf.Config.Config_LoRaConfig_RegionCode.US,
        modemPreset: Protobuf.Config.Config_LoRaConfig_ModemPreset.LONG_FAST,
        hopLimit: 3,
        txEnabled: true,
      },
    },
  })
);
```

### Committing Config Transaction
```typescript
// Source: @meshtastic/core MeshDevice analysis
// After all setConfig/setChannel/setOwner calls:
await device.commitEditSettings();
// Device saves all pending changes to flash and reboots with new config
```

### API Route Pattern (from run.human)
```typescript
// Source: apps/run.human/webapp/src/app/api/user/route.ts
import { auth } from "@auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... business logic
  return NextResponse.json({ /* data */ });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @meshtastic/js (single package) | @meshtastic/core + transport packages (monorepo) | 2024 | Import changed; transport is now a separate package |
| @meshtastic/meshtasticjs | @meshtastic/core | 2024 | Package renamed; old package deprecated |
| Manual beginEditSettings/commitEditSettings | setConfig auto-begins, explicit commit | Current | Simpler API; just call setConfig N times then commit |
| SerialConnection class | MeshDevice + TransportWebSerial | Current | Separation of concerns; transport is pluggable |

**Deprecated/outdated:**
- `@meshtastic/js`: Deprecated. Use `@meshtastic/core` + transport packages
- `@meshtastic/meshtasticjs`: Old package name. Use `@meshtastic/core`
- `SerialConnection` class: Replaced by `MeshDevice` + `TransportWebSerial`
- Manual `beginEditSettings()` before each config change: `setConfig()` auto-handles this now

## Open Questions

1. **MeshDevice setConfig vs setModuleConfig for MQTT**
   - What we know: MQTT is listed under ModuleConfig (ModuleConfigType.MQTT_CONFIG = 0), not under Config. The Config protobuf has device/position/power/network/display/lora/bluetooth/security variants.
   - What's unclear: Whether MeshDevice has a separate `setModuleConfig()` method, or if `setConfig()` handles both Config and ModuleConfig variants via overloading.
   - Recommendation: Check the actual MeshDevice TypeScript source at implementation time. If `setModuleConfig()` exists, use it for MQTT. If not, `setConfig()` may accept ModuleConfig payloads. **LOW confidence** -- needs validation against actual library API at install time.

2. **Protobuf Construction Syntax**
   - What we know: @meshtastic/protobufs v2.7.18 uses protobuf-es (likely @bufbuild/protobuf). The exact construction syntax (Protobuf.Config.Config.create vs new Protobuf.Config.Config) depends on the code generation approach.
   - What's unclear: The exact import paths and constructor patterns. Code examples above use `.create()` pattern but may need adjustment.
   - Recommendation: After installing the package, check `node_modules/@meshtastic/core` and `@meshtastic/protobufs` for actual export structure. Import paths may be `Protobuf.Config.Config` or direct imports. **MEDIUM confidence** -- protobuf-es patterns are well-documented.

3. **Device Reboot Timing After Flash**
   - What we know: ESP32 reboots after flash. Meshtastic firmware boot takes a few seconds. Some USB CDC devices briefly disconnect at OS level.
   - What's unclear: Exact boot time varies by device (ESP32 vs ESP32-S3 vs ESP32-C3). USB CDC reconnection behavior may differ across chip families.
   - Recommendation: Use 4 second initial delay + retry loop (1s intervals, 15s timeout). If serial port disappears from getPorts(), wait for `connect` event on navigator.serial. **MEDIUM confidence** -- needs testing with actual hardware.

4. **MQTT Credential Source**
   - What we know: RunUser entity has mqttUsername/mqttPassword. These are SHA256-derived from userId + creationSeed during user creation in run.human. The flash app needs these same values.
   - What's unclear: Whether to add DynamoDB access to flash app (read RunUser directly) or derive credentials using the same algorithm (userId + seed). Derivation avoids DB dependency but requires sharing RUN_USER_CREATION_SEED.
   - Recommendation: Add ElectroDB/DynamoDB to flash app and read RunUser directly. This is the monorepo pattern -- services share the database. The user entity already exists from run.human registration. Deriving credentials is fragile (algorithm changes break it). **HIGH confidence** -- monorepo shared-DB pattern is established.

5. **Identity Source**
   - What we know: RunUser.displayName exists (e.g., "rabbit_abc1"). Session has user.id and user.name (from OIDC).
   - What's unclear: Which to prefer for long_name. displayName is user-customizable in run.human. session.user.name is the OIDC profile name.
   - Recommendation: Use RunUser.displayName with fallback to session.user.name, then fallback to `DCR34_${userId.slice(0,4)}`. This respects the user's chosen DCR34 identity. Short name is first 4 chars uppercased. **HIGH confidence**.

## Sources

### Primary (HIGH confidence)
- [@meshtastic/core meshDevice.ts source](https://github.com/meshtastic/web/blob/main/packages/core/src/meshDevice.ts) - setConfig, setChannel, setOwner, beginEditSettings, commitEditSettings method signatures and auto-begin behavior
- [@meshtastic/transport-web-serial source](https://github.com/meshtastic/web/blob/main/packages/transport-web-serial/src/transport.ts) - TransportWebSerial class, createFromPort, connect/disconnect lifecycle
- [Meshtastic protobufs admin.proto](https://github.com/meshtastic/protobufs/blob/master/meshtastic/admin.proto) - AdminMessage field numbers (setConfig=34, setChannel=33, setOwner=32, beginEditSettings=64, commitEditSettings=65)
- [Meshtastic protobufs config.proto](https://github.com/meshtastic/protobufs/blob/master/meshtastic/config.proto) - Config.LoRaConfig, RegionCode enum, ModemPreset enum
- [Meshtastic protobufs module_config.proto](https://github.com/meshtastic/protobufs/blob/master/meshtastic/module_config.proto) - MQTTConfig protobuf fields
- [Meshtastic protobufs channel.proto](https://github.com/meshtastic/protobufs/blob/master/meshtastic/channel.proto) - Channel, ChannelSettings, Channel.Role enum
- [MDN Web Serial API - getPorts()](https://developer.mozilla.org/en-US/docs/Web/API/Serial/getPorts) - Port reuse without user gesture
- [Existing codebase] apps/run.human/webapp/src/entities/run-user.ts - RunUser entity with mqttUsername, mqttPassword, displayName
- [Existing codebase] apps/run.flash/webapp/src/hooks/use-serial.ts - Current esptool.js transport and serial port management
- [Existing codebase] apps/run.flash/webapp/src/components/flash/flash-pipeline.tsx - Pipeline UI pattern to reuse

### Secondary (MEDIUM confidence)
- [@meshtastic/protobufs JSR docs](https://jsr.io/@meshtastic/protobufs/doc) - v2.7.18 type listing, Config/ModuleConfig/Channel types
- [Meshtastic examples repo](https://github.com/meshtastic/examples) - React connection pattern (useMeshtasticConnection hook)
- [Meshtastic Channel Configuration docs](https://meshtastic.org/docs/configuration/radio/channels/) - PSK format (0/16/32 bytes), PRIMARY vs SECONDARY roles, consecutive channel requirement
- [Chrome Web Serial docs](https://developer.chrome.com/docs/capabilities/serial) - Port reopen after close, getPorts() behavior

### Tertiary (LOW confidence)
- MQTT as ModuleConfig vs Config - Needs validation at install time against actual @meshtastic/core exports
- Protobuf construction syntax (`.create()` vs `new`) - Depends on protobuf-es version used by @meshtastic/protobufs
- Device reboot timing (3-5s estimate) - Based on general ESP32 boot times, needs hardware testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Meshtastic packages are well-documented and actively maintained (last published 6 days ago)
- Architecture: HIGH - Patterns are well-established in the existing codebase (API route pattern, config pattern, hook pattern, pipeline UI)
- Pitfalls: HIGH - Serial port handoff is the primary risk area; documented thoroughly with mitigation strategies
- Protobuf API surface: MEDIUM - Exact construction syntax and method names need validation against installed packages

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (30 days - libraries are stable, API is mature)
