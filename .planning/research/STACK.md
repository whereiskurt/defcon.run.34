# Technology Stack

**Project:** DCR34 Meshtastic Flasher (flash.defcon.run)
**Researched:** 2026-02-28
**Scope:** New libraries specific to this app only. Framework stack (Next.js 16, React 19, HeroUI, Tailwind 4, ECS Fargate) is inherited from the monorepo and not re-researched.

## Recommended Stack

### Flashing Engine

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `esptool-js` | `^0.5.7` | Flash Meshtastic firmware to ESP32 devices via Web Serial | Espressif's official JS port. Same library used by Meshtastic's own web flasher (flasher.meshtastic.org). No alternative is worth considering -- this IS the standard. Published 2025-08-04, actively maintained. | HIGH |

**API Surface (verified from official docs and TypeScript example):**

```typescript
import { ESPLoader, Transport, type LoaderOptions, type FlashOptions } from "esptool-js";

// 1. Get serial port from user
const port = await navigator.serial.requestPort({ filters: [] });

// 2. Create transport
const transport = new Transport(port, true);

// 3. Create loader
const loaderOptions: LoaderOptions = {
  transport,
  baudrate: 921600,        // Higher baud = faster flash
  terminal: {              // Optional logging terminal
    clean() {},
    writeLine(data: string) { console.log(data); },
    write(data: string) { process.stdout.write(data); },
  },
  debugLogging: false,
};
const esploader = new ESPLoader(loaderOptions);

// 4. Connect and detect chip
const chipName = await esploader.main(); // Returns e.g. "ESP32-S3"

// 5. Flash firmware
const flashOptions: FlashOptions = {
  fileArray: [
    { data: firmwareBinaryString, address: 0x0 },  // Address depends on chip/manifest
  ],
  flashSize: "keep",          // Use existing flash size
  flashMode: "keep",          // Use existing flash mode
  flashFreq: "keep",          // Use existing frequency
  eraseAll: false,            // true for clean install
  compress: true,             // Compress during transfer
  reportProgress: (fileIndex: number, written: number, total: number) => {
    const pct = Math.round((written / total) * 100);
    setProgress(pct);         // Update UI
  },
  calculateMD5Hash: (image: Uint8Array) => md5(image),  // Optional verification
};
await esploader.writeFlash(flashOptions);

// 6. Reset device after flash
await esploader.after();      // Hard reset, device boots new firmware
```

**Key details:**
- `fileArray[].data` is a **binary string** (not Uint8Array). Convert with `String.fromCharCode(...uint8Array)`.
- `fileArray[].address` is the flash offset. For Meshtastic clean install, multiple files at different offsets (bootloader, partition table, firmware, filesystem).
- `reportProgress` callback fires per-file with `(fileIndex, bytesWritten, totalBytes)`.
- After `writeFlash`, call `esploader.after()` for device reset, then **disconnect transport** to release the serial port for Meshtastic configuration step.
- The `Transport` class wraps Web Serial. Only one consumer can hold the port at a time.

**Partition offsets (from Meshtastic web flasher source):**

| Flash Size | OTA Offset | SPIFFS Offset |
|-----------|-----------|---------------|
| 4MB (default) | `0x260000` | `0x300000` |
| 8MB (new table) | `0x5D0000` | `0x670000` |
| 8MB (legacy) | `0x340000` | `0x670000` |
| 16MB | `0x650000` | `0xc90000` |

The `partitionScheme` field in `hardware-list.json` determines which offset table to use.

### Device Configuration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@meshtastic/core` | `^2.6.7` | Push MQTT, channel, identity, and radio config to device after flash | Official Meshtastic JS library. The only supported way to programmatically configure Meshtastic devices from JS. Published 2025-09-11, actively maintained. Sole dependency: `crc@^4.3.2`. | HIGH |
| `@meshtastic/transport-web-serial` | `^0.2.5` | Web Serial transport adapter for @meshtastic/core | Required transport layer for serial communication. Pairs with @meshtastic/core. Depends on `@types/w3c-web-serial@^1.0.7`. | HIGH |

**API Surface (verified from Meshtastic web monorepo source and JSR docs):**

```typescript
import { MeshDevice } from "@meshtastic/core";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";

// 1. Create transport from existing port (SAME port used for flashing)
const transport = await TransportWebSerial.createFromPort(port, 115200);

// 2. Create device
const device = new MeshDevice(transport, "device-id");

// 3. Wait for device to be ready (listen for metadata)
// Device emits events via subscription pattern

// 4. Push configuration
await device.setConfig({
  payloadVariant: {
    case: "mqtt",
    value: {
      enabled: true,
      address: "mqtt.defcon.run",
      username: "user-abc123",
      password: "generated-credential",
      encryptionEnabled: true,
      // ... other MQTT config
    },
  },
});

await device.setChannel({
  index: 0,
  role: "PRIMARY",   // Channel_Role enum
  settings: {
    name: "DCR34",
    psk: pskBytes,    // Uint8Array
    // ... uplink/downlink settings
  },
});

await device.setOwner({
  longName: "Runner Alice",
  shortName: "ALIC",
});

// 5. Commit changes
await device.commitEditSettings();
```

**Key methods on MeshDevice (verified from source):**

| Method | Purpose |
|--------|---------|
| `setConfig(config)` | Set device config (MQTT, LoRa, display, etc.) via protobuf AdminMessage |
| `setModuleConfig(config)` | Set module-specific config |
| `setChannel(channel)` | Set channel settings (name, PSK, role) |
| `setOwner(owner)` | Set device owner (long name, short name) |
| `getConfig(type)` | Read current config from device |
| `getChannel(index)` | Read channel config |
| `getOwner()` | Read owner info |
| `getMetadata(nodeNum)` | Read device metadata |
| `beginEditSettings()` | Start config edit session |
| `commitEditSettings()` | Commit all pending config changes |
| `factoryResetDevice()` | Factory reset |
| `reboot(seconds)` | Reboot device |

**Critical pattern: Port handoff between esptool.js and @meshtastic/core.**

The serial port can only have one consumer at a time. After flashing with esptool.js:

1. Call `esploader.after()` to reset the device
2. Disconnect esptool's `Transport` (release the reader lock)
3. Wait ~2-3 seconds for the device to boot the new firmware
4. Open the same `SerialPort` at 115200 baud via `TransportWebSerial.createFromPort(port, 115200)`
5. Create `MeshDevice` and push configuration

The Meshtastic web flasher handles this by toggling RTS signals, waiting 100ms, disconnecting the esptool transport, then reopening at 115200. The port object from `navigator.serial.requestPort()` persists across close/reopen cycles within the same page.

### Firmware ZIP Handling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@zip.js/zip.js` | `^2.8.21` | Extract firmware .bin files from Meshtastic firmware ZIPs | Actively maintained (last publish: 2026-02-18). Used by the official Meshtastic web flasher. Supports streaming extraction, Web Workers, modern ESM. JSZip (3.10.1) hasn't had a release since April 2022 and should NOT be used. | HIGH |

**Usage pattern (from Meshtastic web flasher):**

```typescript
import { BlobReader, ZipReader, BlobWriter } from "@zip.js/zip.js";

// Extract specific firmware binary from ZIP
const zipReader = new ZipReader(new BlobReader(zipBlob));
const entries = await zipReader.getEntries();

// Find the firmware file matching the device's platformioTarget
const firmwareEntry = entries.find(e =>
  e.filename.includes(device.platformioTarget)
);

if (firmwareEntry) {
  const blob = await firmwareEntry.getData(new BlobWriter());
  const arrayBuffer = await blob.arrayBuffer();
  const firmwareBytes = new Uint8Array(arrayBuffer);
  // Convert to binary string for esptool.js
  const binaryString = Array.from(firmwareBytes)
    .map(b => String.fromCharCode(b))
    .join("");
}

await zipReader.close();
```

**Note on vendoring:** The design doc specifies vendoring firmware ZIPs into the Docker image. If firmware is pre-extracted at build time (individual .bin files baked into the image), `@zip.js/zip.js` becomes unnecessary at runtime. However, keeping ZIP support is recommended for flexibility -- it allows downloading firmware on-demand as a fallback and simplifies the vendoring process (vendor one ZIP per architecture instead of hundreds of individual .bin files).

### Device Database

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Meshtastic `hardware-list.json` | Vendored (pinned to firmware version) | Device picker data: names, images, chip architectures, platformio targets | Official Meshtastic hardware database. ~122 devices. Same source used by flasher.meshtastic.org. Vendor into app, filter to ESP32 architectures only. | HIGH |

**Structure of each device entry:**

```typescript
interface HardwareDevice {
  hwModel: number;            // Numeric ID
  hwModelSlug: string;        // e.g. "HELTEC_V3"
  platformioTarget: string;   // e.g. "heltec-v3" -- maps to firmware filename
  architecture: string;       // "esp32" | "esp32-s3" | "esp32-c3" | "esp32-c6" | "nrf52840" | ...
  activelySupported: boolean;
  supportLevel?: number;      // 1-3 (when activelySupported)
  displayName: string;        // e.g. "Heltec V3"
  tags: string[];             // e.g. ["Heltec"]
  images?: string[];          // SVG filenames
  partitionScheme?: string;   // Flash layout identifier
  requiresDfu?: boolean;
  hasInkHud?: boolean;
  hasMui?: boolean;
}
```

**Filter at build time:** Only include entries where `architecture` starts with `esp32`. This drops nRF52, RP2040, and STM32 devices that cannot be flashed via Web Serial.

### Browser API

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Web Serial API | Chrome 89+ / Edge 89+ | Hardware communication with ESP32 devices | The only browser API for serial port access. No polyfill exists for Firefox/Safari -- this is a hard browser requirement. Gate unsupported browsers at page load. | HIGH |

**Browser detection:**

```typescript
const isWebSerialSupported = "serial" in navigator;

// Gate at entry
if (!isWebSerialSupported) {
  // Show "Chrome or Edge required" message
  // Do NOT let user proceed to device picker
}
```

**Key constraints:**
- Requires HTTPS in production (CloudFront satisfies this)
- `localhost` is exempt from HTTPS requirement (dev works)
- User gesture required to call `navigator.serial.requestPort()` (must be in click handler)
- Only one tab can hold a serial port at a time
- `navigator.serial.getPorts()` returns previously-granted ports (no re-prompt needed)

### Binary Data Utilities

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Built-in `TextEncoder`/`Uint8Array` | Native | Convert between binary formats for esptool.js | No library needed. esptool.js expects binary strings (`String.fromCharCode` per byte). Simple utility function, not a dependency. | HIGH |

**Conversion utility (from Meshtastic web flasher):**

```typescript
function convertToBinaryString(data: Uint8Array): string {
  let binaryString = "";
  for (let i = 0; i < data.length; i++) {
    binaryString += String.fromCharCode(data[i]);
  }
  return binaryString;
}
```

**Performance note:** For large firmware files (1-4MB), this loop is fast enough. The bottleneck is the serial transfer, not the conversion.

## Firmware Source and Vendoring

**Firmware URL pattern (from Meshtastic web flasher source):**

```
https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/firmware-{version}/
```

Each firmware version directory contains ~296 files including:
- `firmware-{platformioTarget}-{version}.bin` -- main firmware binary
- `firmware-{platformioTarget}-{version}-update.bin` -- OTA update binary
- `littlefs-{platformioTarget}-{version}.bin` -- filesystem image
- `device-install.sh` / `device-install.bat` -- CLI install scripts
- Bootloader and partition table binaries (shared across devices of same architecture)

**For clean install (erase + flash), multiple files are needed at specific offsets.** The Meshtastic web flasher uses a manifest-driven approach where the firmware directory structure implies the file names from the `platformioTarget`.

**Vendoring strategy for Docker:**
1. At build time, download firmware ZIPs for pinned version(s)
2. Extract and include only ESP32-architecture `.bin` files
3. Serve from `/public/firmware/` or a Next.js API route
4. No runtime dependency on GitHub availability

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| ESP32 flashing | `esptool-js` (Espressif official) | `esptool.ts` (Toitware fork) | Fork is less maintained, smaller community. Espressif's version is canonical and used by Meshtastic upstream. |
| ESP32 flashing | `esptool-js` (Espressif official) | `esp-web-tools` (ESPHome) | Different use case -- esp-web-tools is a web component for ESPHome devices. Does not support arbitrary firmware flashing with the control we need. |
| ZIP extraction | `@zip.js/zip.js` | `jszip` | JSZip last released April 2022 (3.10.1). `@zip.js/zip.js` is actively maintained, used by Meshtastic flasher, supports streaming and Web Workers. |
| ZIP extraction | `@zip.js/zip.js` | `fflate` | `fflate` is faster but ZIP-level API is less ergonomic. `@zip.js/zip.js` has cleaner entry-based extraction which is exactly what we need. |
| Meshtastic config | `@meshtastic/core` | Direct protobuf + serial | Reinventing the wheel. `@meshtastic/core` handles protobuf serialization, packet framing, and the Meshtastic serial protocol. No reason to reimplement. |
| Device database | Vendored `hardware-list.json` | Build our own | The official database is comprehensive, maintained by Meshtastic, and used by their own flasher. Vendoring it is the correct approach. |

## What NOT to Use

| Library/Approach | Why Not |
|-----------------|---------|
| `@meshtastic/js` (old package) | Deprecated. Code migrated to `@meshtastic/core` in the Meshtastic web monorepo. The npm package `@meshtastic/js` exists but points to stale code. |
| `@meshtastic/meshtasticjs` | Even older deprecated package. Use `@meshtastic/core`. |
| `jszip` | Unmaintained since 2022. Use `@zip.js/zip.js`. |
| `esptool.ts` (senseshift fork) | Unofficial fork of Toitware's fork. Two generations removed from canonical. |
| `web-serial-polyfill` | Only relevant for Chrome on Android. Desktop Chrome/Edge have native support. Our app is desktop-only (USB cable required). |
| Custom protobuf implementation | `@meshtastic/core` already handles all protobuf encoding/decoding for Meshtastic protocol. |
| `esp-web-tools` | ESPHome-specific web component. Wrong abstraction level -- we need raw flash control. |

## Installation

```bash
# Core flashing and configuration
npm install esptool-js@^0.5.7 @meshtastic/core@^2.6.7 @meshtastic/transport-web-serial@^0.2.5

# ZIP extraction (only if not pre-extracting firmware at build time)
npm install @zip.js/zip.js@^2.8.21

# Type definitions for Web Serial (dev dependency)
npm install -D @types/w3c-web-serial@^1.0.7
```

**Note:** `@meshtastic/transport-web-serial` already depends on `@types/w3c-web-serial`, but installing it explicitly as a devDependency ensures TypeScript can resolve Web Serial types in your own code.

## Version Pinning Strategy

| Package | Strategy | Rationale |
|---------|----------|-----------|
| `esptool-js` | Pin to `^0.5.7` | Stable API since 0.5.x. Minor bumps are safe. |
| `@meshtastic/core` | Pin to `^2.6.7` | Active development. Must match firmware version compatibility. Test after upgrades. |
| `@meshtastic/transport-web-serial` | Pin to `^0.2.5` | Tightly coupled to `@meshtastic/core`. Upgrade together. |
| `@zip.js/zip.js` | Pin to `^2.8.21` | Stable API. Minor bumps are safe. |

## Known Issues and Browser Compatibility

### Chrome 139 setSignals Bug (RESOLVED)
Chrome 139.0.7258.66 had a bug where `setSignals` on SerialPort failed on Linux/macOS, breaking esptool.js connections. Fixed in Chrome 141+. As of February 2026 (Chrome 145+), this is a non-issue.

### Single-Tab Serial Port Lock
Only one browser tab can hold a serial port. A failed/crashed tab may not release the port. The UI should detect this and instruct the user to close other tabs or refresh.

### USB Driver Requirements
Some ESP32 boards (especially those with CH340/CH9102 USB-UART chips) require driver installation on macOS. The app should link to driver download pages when connection fails.

## Sources

- [esptool-js GitHub repository](https://github.com/espressif/esptool-js) -- Espressif official, verified current
- [esptool-js API documentation](https://espressif.github.io/esptool-js/docs/) -- ESPLoader class reference, FlashOptions interface
- [esptool-js TypeScript example](https://github.com/espressif/esptool-js/tree/main/examples/typescript) -- Reference implementation
- [@meshtastic/core on JSR](https://jsr.io/@meshtastic/core) -- Package exports, version 2.6.7
- [@meshtastic/core on npm](https://www.npmjs.com/package/@meshtastic/core) -- npm distribution
- [Meshtastic web monorepo](https://github.com/meshtastic/web) -- Source code for @meshtastic/core and transport packages
- [Meshtastic web flasher](https://github.com/meshtastic/web-flasher) -- Reference implementation using esptool-js + @meshtastic/core
- [Meshtastic web-flasher-events](https://github.com/meshtastic/web-flasher-events) -- Event-specific flasher variant (validates our use case)
- [Meshtastic JS development docs](https://meshtastic.org/docs/development/js/) -- Transport options documentation
- [Web Serial API on MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) -- Browser API reference
- [Web Serial API on Can I Use](https://caniuse.com/web-serial) -- Browser support matrix
- [Chrome 139 esptool-js issue #206](https://github.com/espressif/esptool-js/issues/206) -- Resolved Chrome compatibility bug
- [Meshtastic firmware releases](https://github.com/meshtastic/firmware/releases) -- Firmware download structure
- [Meshtastic hardware-list.json](https://github.com/meshtastic/web-flasher/blob/main/public/data/hardware-list.json) -- Device database source
- [DeepWiki: Meshtastic Web Client](https://deepwiki.com/meshtastic/meshtastic/4.2-web-client-and-tools) -- Architecture overview
