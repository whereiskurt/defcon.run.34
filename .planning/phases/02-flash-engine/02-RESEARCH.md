# Phase 2: Flash Engine - Research

**Researched:** 2026-02-28
**Domain:** Web Serial API + esptool.js firmware flashing for ESP32 devices
**Confidence:** HIGH

## Summary

Phase 2 delivers USB serial connection and firmware flashing for ESP32 Meshtastic devices in the browser. The core technology is esptool.js (v0.5.6), Espressif's official JavaScript implementation of their flash tool, which operates over the Web Serial API. This is a well-established library used by the official Meshtastic web flasher (flasher.meshtastic.org) and Espressif's own demo tools.

The implementation involves two main concerns: (1) Web Serial connection management with chip detection and error handling, and (2) firmware flashing with a staged progress pipeline (erase, write, verify). Meshtastic firmware releases include a factory binary (`firmware-{device}-{version}.factory.bin`) that is a pre-combined image containing bootloader, partition table, and application, flashable at address 0x0. This is the simplest and most reliable approach for fresh provisioning.

**Primary recommendation:** Use esptool.js v0.5.6 with the Meshtastic factory binary (single file at 0x0), `eraseAll: true` in FlashOptions, and a custom `useSerial` hook to encapsulate Web Serial + esptool.js lifecycle. Serve firmware from `public/firmware/` as static files during development (FLSH-05 vendoring into Docker is Phase 4 scope).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Show selected device name and image at top of Connect step as confirmation, then connect button below
- After successful connection: show connected status (port name, chip info if available) with manual "Continue to Flash" button -- no auto-advance
- Bootloader guidance on connection failure: expandable troubleshooting section, hidden by default. Brief error message visible, detailed bootloader steps in expandable
- Bootloader instructions: generic ESP32 guidance ("Hold BOOT, press RESET") plus link to device-specific Meshtastic docs page
- Staged pipeline visualization: three distinct stages -- Erase, Write, Verify -- each with its own progress indicator
- The Write stage gets the detailed percentage bar (longest operation)
- Moderate detail level: stage name + percentage + bytes transferred (e.g., "Writing firmware... 47% (384KB / 816KB)")
- Hidden expandable console at bottom -- "Show details" toggle reveals raw esptool serial output. Hidden by default
- Flash success: all three pipeline stages turn green with checkmarks. Brief summary text. "Continue to Configure" button below
- Manual flash start -- user must click "Flash Firmware" button explicitly. No auto-start, no countdown
- Clear erase warning before flash button: "This will erase all existing firmware and data on the device"
- Pre-flash info panel shows: device name, detected chip info from serial connection, firmware version, firmware file size
- Chip validation: compare detected chip family (e.g., ESP32-S3) against selected device's architecture. Mismatch blocks flash with clear warning
- Mid-flash disconnect: guided step-by-step recovery (1. Don't panic 2. Reconnect USB 3. Put device in bootloader mode 4. Click Retry)
- Retry sends user back to Connect step -- clean slate, guarantees fresh serial connection before reflashing
- Verification failure treated as flash failure -- full retry from erase, no "continue anyway" option
- Unlimited retries -- no artificial retry limits

### Claude's Discretion
- Exact progress bar/pipeline component styling and animations
- esptool.js integration approach and configuration (baud rate, flash mode, memory addresses)
- Firmware binary loading mechanism (static files vs API route)
- Console log formatting and scroll behavior
- Transition animations between stages

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONN-01 | User can initiate Web Serial connection via browser prompt (user-initiated gesture required) | Web Serial API `navigator.serial.requestPort()` requires user gesture (click handler). esptool.js `Transport` wraps the returned `SerialPort`. |
| CONN-02 | App handles connection failures with actionable error messages | esptool.js throws typed errors on connection failure. `Transport` supports `deviceLostCallback` for disconnect detection. Common errors: port in use, permission denied, device not in bootloader mode. |
| CONN-03 | App provides device-specific bootloader guidance (hold BOOT, press RESET) when connection fails | Expandable troubleshooting section with generic ESP32 bootloader instructions + link to Meshtastic device docs. Locked in CONTEXT.md. |
| FLSH-01 | App performs full erase before flashing (fresh provisioning, not update) | esptool.js `eraseFlash()` or `writeFlash({ eraseAll: true })`. The `eraseAll: true` flag in FlashOptions erases all sectors before writing. |
| FLSH-02 | App flashes DCR34-pinned Meshtastic firmware via esptool.js over Web Serial | esptool.js `writeFlash()` with factory binary at address 0x0. Factory bin includes bootloader + partition table + app. |
| FLSH-03 | Flash progress is displayed with percentage and meaningful status text | `reportProgress(fileIndex, written, total)` callback in FlashOptions. Plus `IEspLoaderTerminal` for raw console output. |
| FLSH-04 | Flash completion shows clear success or failure state with actionable guidance on failure | esptool.js `writeFlash()` resolves on success, throws on failure. Post-flash `flashMd5sum()` for verification. |
| FLSH-05 | Firmware binaries are vendored into the Docker image -- zero runtime external dependencies | Firmware served from app (public/ directory during dev). Docker vendoring is Phase 4 (DPLY-05), but Phase 2 MUST serve from app, not fetch from GitHub at runtime. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| esptool.js | 0.5.6 | ESP32 firmware flashing over Web Serial | Official Espressif JS implementation. Used by Meshtastic's own web flasher. Apache 2.0. |
| @types/w3c-web-serial | 1.0.8 | TypeScript types for Web Serial API | DefinitelyTyped package providing `navigator.serial`, `SerialPort` types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| HeroUI (already installed) | 2.8.9 | UI components (Button, Card, Progress, Accordion) | All UI elements -- buttons, cards, expandable sections |
| framer-motion (already installed) | 12.34.3 | Step transitions and progress animations | Pipeline stage transitions, progress bar animations |
| lucide-react (already installed) | 0.561.0 | Icons (Check, AlertTriangle, Usb, Cpu, etc.) | Status icons, pipeline checkmarks, error indicators |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| esptool.js | esp-web-tools (ESPHome) | esp-web-tools is higher-level but opinionated (uses manifest.json, provides its own UI). esptool.js gives full control over the flash process, matching our custom staged pipeline UX. |
| @types/w3c-web-serial | @types/dom-serial | Both provide Web Serial types. w3c-web-serial is more actively maintained (1.0.8 vs 1.0.6) and more widely used. |
| Separate erase + write | eraseAll flag in writeFlash | Separate calls give staged progress but require reconnection. `eraseAll: true` handles it atomically in one call but conflates erase and write progress. Recommendation: use `eraseFlash()` separately, then `writeFlash({ eraseAll: false })` for distinct stage tracking. |

**Installation:**
```bash
cd apps/run.flash/webapp
npm install esptool-js@^0.5.6
npm install -D @types/w3c-web-serial@^1.0.8
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── hooks/
│   ├── use-wizard.ts          # Existing -- extend with serial/flash state
│   ├── use-serial.ts          # NEW -- Web Serial connection lifecycle
│   └── use-flash.ts           # NEW -- esptool.js flash orchestration
├── components/
│   ├── wizard/
│   │   ├── wizard-container.tsx  # Existing -- replace PlaceholderSteps
│   │   └── wizard-stepper.tsx    # Existing
│   ├── connect/
│   │   ├── connect-step.tsx      # NEW -- device connection UI
│   │   ├── connection-status.tsx # NEW -- port name, chip info display
│   │   └── bootloader-help.tsx   # NEW -- expandable troubleshooting
│   └── flash/
│       ├── flash-step.tsx        # NEW -- pre-flash confirmation + flash UI
│       ├── flash-pipeline.tsx    # NEW -- Erase/Write/Verify stage visualization
│       ├── flash-console.tsx     # NEW -- expandable raw serial output
│       └── chip-mismatch.tsx     # NEW -- architecture mismatch warning
├── config/
│   ├── firmware.ts               # NEW -- firmware version, file paths, flash addresses
│   └── devices.ts                # Existing
├── lib/
│   └── esptool.ts                # NEW -- esptool.js wrapper (Transport, ESPLoader init)
└── types/
    ├── device.ts                 # Existing
    └── serial.ts                 # NEW -- serial connection and flash state types
```

### Pattern 1: Custom Hook for Web Serial Lifecycle (`useSerial`)
**What:** Encapsulate `navigator.serial.requestPort()`, `Transport`, `ESPLoader` initialization, chip detection, and cleanup in a single hook.
**When to use:** Any component that needs serial port access.
**Example:**
```typescript
// Source: esptool-js API docs + Web Serial API spec
interface UseSerialReturn {
  port: SerialPort | null;
  chipName: string | null;
  chipDescription: string | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  espLoader: ESPLoader | null;
  transport: Transport | null;
}

function useSerial(): UseSerialReturn {
  // 1. requestPort() -- MUST be in click handler (user gesture required)
  // 2. new Transport(port)
  // 3. new ESPLoader({ transport, baudrate: 115200, terminal })
  // 4. await espLoader.main() -- returns chip type string
  // 5. await espLoader.chip.getChipDescription(espLoader) -- detailed chip info
  // 6. Cleanup: transport.disconnect() on unmount or error
}
```

### Pattern 2: Staged Flash Pipeline (`useFlash`)
**What:** Orchestrate erase -> write -> verify as three distinct stages with independent progress.
**When to use:** The flash step component.
**Example:**
```typescript
// Source: esptool-js ESPLoader API
type FlashStage = 'idle' | 'erasing' | 'writing' | 'verifying' | 'complete' | 'error';

interface FlashProgress {
  stage: FlashStage;
  eraseComplete: boolean;
  writePercent: number;       // 0-100
  writtenBytes: number;
  totalBytes: number;
  verifyComplete: boolean;
  error: string | null;
}

async function flashDevice(espLoader: ESPLoader, firmwareData: Uint8Array): Promise<void> {
  // Stage 1: Erase
  setStage('erasing');
  await espLoader.eraseFlash();

  // Stage 2: Write
  setStage('writing');
  await espLoader.writeFlash({
    fileArray: [{ data: firmwareData, address: 0x0 }],
    flashSize: 'keep',
    flashMode: 'keep',
    flashFreq: 'keep',
    eraseAll: false,  // Already erased in stage 1
    compress: true,
    reportProgress: (fileIndex, written, total) => {
      setWriteProgress({ writtenBytes: written, totalBytes: total, writePercent: Math.round(written / total * 100) });
    },
  });

  // Stage 3: Verify (MD5 check)
  setStage('verifying');
  const flashMd5 = await espLoader.flashMd5sum(0x0, firmwareData.length);
  // Compare with expected MD5
}
```

### Pattern 3: Terminal Logger for Console Output
**What:** Implement `IEspLoaderTerminal` interface to capture esptool.js raw output for the expandable console.
**When to use:** When creating the ESPLoader instance.
**Example:**
```typescript
// Source: esptool-js IEspLoaderTerminal interface
interface IEspLoaderTerminal {
  clean: () => void;
  writeLine: (data: string) => void;
  write: (data: string) => void;
}

function createTerminalLogger(appendLog: (line: string) => void): IEspLoaderTerminal {
  return {
    clean: () => {},  // No-op for our use case
    writeLine: (data: string) => appendLog(data + '\n'),
    write: (data: string) => appendLog(data),
  };
}
```

### Pattern 4: Firmware Binary Loading
**What:** Load firmware binary as `Uint8Array` from a static file served by the app.
**When to use:** Before initiating flash.
**Example:**
```typescript
// Firmware served from public/firmware/ directory
async function loadFirmware(device: DeviceHardware, version: string): Promise<Uint8Array> {
  const filename = getFirmwareFilename(device, version);
  const response = await fetch(`/firmware/${filename}`);
  if (!response.ok) throw new Error(`Failed to load firmware: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
```

### Anti-Patterns to Avoid
- **Auto-advancing after connection:** User explicitly confirmed they want manual "Continue to Flash" button. Never auto-advance.
- **Fetching firmware from GitHub at runtime:** FLSH-05 requires zero runtime external dependencies. Serve firmware from the app itself.
- **Using `eraseAll: true` in `writeFlash`:** This conflates erase and write stages, making it impossible to show distinct Erase/Write progress stages. Call `eraseFlash()` separately.
- **Storing ESPLoader/Transport in React state:** These are mutable class instances with internal state. Store in `useRef`, not `useState`. Only store derived values (chipName, isConnected) in state.
- **Forgetting to disconnect on error/unmount:** Always call `transport.disconnect()` in cleanup. Stale serial port locks prevent reconnection.
- **Skipping the user gesture requirement:** `navigator.serial.requestPort()` MUST be called inside a user-initiated event handler (click). Cannot be called on mount or in useEffect.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serial communication protocol | Custom serial read/write over Web Serial | esptool.js `Transport` class | SLIP encoding, buffering, signal control, baud rate management |
| ESP32 bootloader protocol | Custom stub upload, sync, chip detection | esptool.js `ESPLoader` class | Hundreds of chip-specific magic numbers, stub binaries, memory maps |
| Flash erase/write | Direct serial commands to flash controller | esptool.js `eraseFlash()` / `writeFlash()` | Compression, block alignment, sector management, chip-specific flash layouts |
| MD5 verification | Custom hash implementation | esptool.js `flashMd5sum()` | Reads directly from device flash, compares with local hash |
| Firmware binary format | Custom bootloader+partition+app assembly | Meshtastic factory binary (pre-combined) | Factory binary is already assembled correctly by the Meshtastic build system |
| Chip family detection | Parse chip IDs manually | esptool.js `espLoader.chip.CHIP_NAME` | Magic number lookup table covering 11+ chip variants |

**Key insight:** esptool.js handles ALL low-level serial flash protocol complexity. The custom code is purely UI orchestration -- calling esptool.js methods in sequence and rendering progress.

## Common Pitfalls

### Pitfall 1: Serial Port Already In Use
**What goes wrong:** User gets "Failed to open serial port" or "port is already in use" error.
**Why it happens:** Another browser tab, application (Arduino IDE, Meshtastic Python CLI), or even a previously crashed tab still holds the serial port lock.
**How to avoid:** (1) Display clear error message telling user to close other serial applications. (2) On retry, request a NEW port via `requestPort()` -- don't try to reuse the old reference. (3) Always call `transport.disconnect()` in cleanup/error paths.
**Warning signs:** Error on `Transport.connect()` before any communication begins.

### Pitfall 2: Device Not in Bootloader Mode
**What goes wrong:** esptool.js cannot sync with the device. Throws timeout error after multiple connection attempts.
**Why it happens:** ESP32 devices need to be in bootloader/download mode to accept flash commands. Most boards have auto-reset circuitry, but some require manual BOOT+RESET button sequence.
**How to avoid:** Show the expandable bootloader guidance (CONTEXT.md decision). Key instruction: "Hold BOOT button, press and release RESET, then release BOOT." Link to device-specific Meshtastic docs.
**Warning signs:** Timeout during `espLoader.main()` or `espLoader.connect()`.

### Pitfall 3: Chip Architecture Mismatch
**What goes wrong:** User selects wrong device in picker (e.g., picks ESP32-S3 device but has ESP32 connected). Flashing wrong firmware bricks the device until re-flashed with correct firmware.
**Why it happens:** Users may not know their exact board model.
**How to avoid:** After connection, compare `espLoader.chip.CHIP_NAME` (e.g., "ESP32-S3") against the selected device's `architecture` field. Block flash if mismatch. This is a locked CONTEXT.md decision.
**Warning signs:** `CHIP_NAME` doesn't match `architecture` after successful connection.

### Pitfall 4: Mid-Flash USB Disconnect
**What goes wrong:** User unplugs USB cable or device loses power during flash. Device may be left in a bricked state (no bootable firmware).
**Why it happens:** Physical cable connection is fragile. Users may accidentally bump the cable.
**How to avoid:** (1) Display warning not to disconnect during flash. (2) On disconnect detection (via `Transport` error or `navigator.serial` disconnect event), show the guided recovery steps (CONTEXT.md decision). (3) Retry always goes back to Connect step for fresh connection.
**Warning signs:** `Transport.read()` or `Transport.write()` throws during active flash operation.

### Pitfall 5: SSR/Hydration Issues with Web Serial
**What goes wrong:** Next.js server-side rendering tries to access `navigator.serial`, which doesn't exist on the server. Build fails or hydration mismatch occurs.
**Why it happens:** Web Serial API is browser-only. Next.js renders components on the server first.
**How to avoid:** (1) All serial-related code MUST be in `"use client"` components. (2) Guard all `navigator.serial` access with `typeof window !== 'undefined'` checks or defer to `useEffect`. (3) esptool.js should be dynamically imported only on client side, OR just ensure the module is only used within `"use client"` components (Next.js handles this correctly for client components).
**Warning signs:** Build errors referencing `navigator` or `SerialPort` during SSR.

### Pitfall 6: esptool.js Bundle Size / WebWorker Considerations
**What goes wrong:** esptool.js includes stub binaries for all chip families, which can bloat the client bundle.
**Why it happens:** The library bundles base64-encoded stub loaders for each supported chip.
**How to avoid:** This is acceptable for our use case since the flash page is a dedicated tool, not a general website. The bundle increase is ~200-300KB which is reasonable for a firmware flasher. No need for code splitting or lazy loading of esptool.js beyond normal Next.js client component handling.
**Warning signs:** Unexpectedly large JS bundle size in build output.

### Pitfall 7: Baud Rate Issues
**What goes wrong:** Flash operation is extremely slow or fails intermittently.
**Why it happens:** Default 115200 baud may be suboptimal. Higher baud rates (460800, 921600) are faster but may fail on some USB-serial chips (especially CH340).
**How to avoid:** Start at 115200 for initial connection, then let esptool.js negotiate higher baud for flashing (the stub loader supports `changeBaud()`). If baud change fails, it falls back to the initial rate. No user-facing baud rate selection needed.
**Warning signs:** Flash taking >5 minutes for a ~1MB firmware file.

## Code Examples

Verified patterns from official sources:

### Complete Connection Flow
```typescript
// Source: esptool-js API docs (v0.5.6) + Web Serial API spec
import { ESPLoader, Transport } from 'esptool-js';
import type { IEspLoaderTerminal } from 'esptool-js';

async function connectToDevice(
  appendLog: (line: string) => void
): Promise<{ espLoader: ESPLoader; transport: Transport; chipName: string }> {
  // 1. Request port (MUST be in user gesture handler)
  const port = await navigator.serial.requestPort();

  // 2. Create transport
  const transport = new Transport(port);

  // 3. Create terminal logger
  const terminal: IEspLoaderTerminal = {
    clean: () => {},
    writeLine: (data) => appendLog(data + '\n'),
    write: (data) => appendLog(data),
  };

  // 4. Create ESPLoader
  const espLoader = new ESPLoader({
    transport,
    baudrate: 115200,
    terminal,
  });

  // 5. Connect and detect chip
  const chipType = await espLoader.main();
  // chipType is like "esp32s3" -- the ROM identifier

  // 6. Get human-readable chip info
  const chipDescription = await espLoader.chip.getChipDescription(espLoader);
  const chipName = espLoader.chip.CHIP_NAME;
  // chipName is like "ESP32-S3"

  return { espLoader, transport, chipName };
}
```

### Chip Validation
```typescript
// Source: esptool-js chip detection + DeviceHardware type
function validateChipMatch(
  detectedChipName: string,   // e.g., "ESP32-S3" from espLoader.chip.CHIP_NAME
  selectedArchitecture: string // e.g., "esp32-s3" from DeviceHardware.architecture
): boolean {
  // Normalize: esptool.js uses "ESP32-S3", our device type uses "esp32-s3"
  const normalized = detectedChipName.toLowerCase().replace(/\s+/g, '-');
  // Handle edge case: esptool.js returns "ESP32" for base ESP32
  return normalized === selectedArchitecture ||
         (normalized === 'esp32' && selectedArchitecture === 'esp32');
}
```

### Complete Flash Flow with Staged Progress
```typescript
// Source: esptool-js FlashOptions + ESPLoader.writeFlash API docs
import type { ESPLoader } from 'esptool-js';

interface StageProgress {
  stage: 'idle' | 'erasing' | 'writing' | 'verifying' | 'complete' | 'error';
  writePercent: number;
  writtenBytes: number;
  totalBytes: number;
  error: string | null;
}

async function flashFirmware(
  espLoader: ESPLoader,
  firmwareData: Uint8Array,
  onProgress: (progress: StageProgress) => void,
): Promise<void> {
  try {
    // Stage 1: Erase entire flash
    onProgress({ stage: 'erasing', writePercent: 0, writtenBytes: 0, totalBytes: firmwareData.length, error: null });
    await espLoader.eraseFlash();

    // Stage 2: Write firmware
    // Factory binary goes at address 0x0 (includes bootloader + partition table + app)
    onProgress({ stage: 'writing', writePercent: 0, writtenBytes: 0, totalBytes: firmwareData.length, error: null });
    await espLoader.writeFlash({
      fileArray: [{ data: firmwareData, address: 0x0 }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,   // Already erased in stage 1
      compress: true,
      reportProgress: (fileIndex: number, written: number, total: number) => {
        onProgress({
          stage: 'writing',
          writePercent: Math.round((written / total) * 100),
          writtenBytes: written,
          totalBytes: total,
          error: null,
        });
      },
    });

    // Stage 3: Verify via MD5
    onProgress({ stage: 'verifying', writePercent: 100, writtenBytes: firmwareData.length, totalBytes: firmwareData.length, error: null });
    const deviceMd5 = await espLoader.flashMd5sum(0x0, firmwareData.length);
    // Calculate local MD5 for comparison
    // Note: calculateMD5Hash is optional in FlashOptions -- can compute separately

    onProgress({ stage: 'complete', writePercent: 100, writtenBytes: firmwareData.length, totalBytes: firmwareData.length, error: null });

  } catch (err) {
    onProgress({
      stage: 'error',
      writePercent: 0,
      writtenBytes: 0,
      totalBytes: firmwareData.length,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
    throw err;
  }
}
```

### Loading Firmware from Static Files
```typescript
// Source: Fetch API + DeviceHardware type
import { getFirmwareFilename } from '@/types/device';
import type { DeviceHardware } from '@/types/device';

// Firmware config
const FIRMWARE_VERSION = '2.6.2.0b1be85';  // DCR34-pinned version (placeholder)

async function loadFirmware(device: DeviceHardware): Promise<{ data: Uint8Array; size: number }> {
  const filename = getFirmwareFilename(device, FIRMWARE_VERSION);
  // Factory binary includes bootloader + partition table + app
  const factoryFilename = filename.replace('.bin', '.factory.bin');

  const response = await fetch(`/firmware/${factoryFilename}`);
  if (!response.ok) {
    throw new Error(`Firmware not found for ${device.displayName}. File: ${factoryFilename}`);
  }

  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  return { data, size: data.length };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| esp-web-flasher (community) | esptool.js (official Espressif) | 2023+ | esptool.js is the canonical implementation, actively maintained by Espressif |
| Multi-file flash (bootloader + partition + app separately) | Factory binary (single combined file at 0x0) | Always available, increasingly standard | Single file simplifies flash process, eliminates address offset errors |
| Chrome-only (no polyfill) | Chrome + Edge + Android Chrome | Web Serial API stabilized in Chrome 89+ | Broader browser support within Chromium family |
| esptool.js v0.4.x | esptool.js v0.5.6 | June 2025 | Added ESP32-P4, ESP32-C5 support, fixed ESP32-C3 USB-JTAG issues, improved stability |

**Deprecated/outdated:**
- esp-web-flasher: Community fork, superseded by official esptool.js
- esptool.js v0.4.x: Missing newer chip support and bug fixes present in v0.5.x

## Open Questions

1. **Meshtastic firmware version to pin**
   - What we know: 1-2 vetted versions will be chosen for DCR34. Version is event decision, not yet made.
   - What's unclear: Exact version number. This affects firmware filenames and which factory binaries to vendor.
   - Recommendation: Use a placeholder version in `config/firmware.ts` (e.g., `"2.6.2.0b1be85"`) that can be updated when the event decision is made. The code should work with any version since the naming convention is stable.

2. **Factory binary vs multi-file flash**
   - What we know: Meshtastic releases include factory binaries (combined bootloader + partition + app). The device-install.sh script uses the factory binary at offset 0x0 with separate OTA and littlefs files.
   - What's unclear: Whether Phase 2 needs to also flash OTA and littlefs partitions. For fresh provisioning, the factory binary alone should be sufficient since Phase 3 will push configuration via @meshtastic/core.
   - Recommendation: Flash ONLY the factory binary at 0x0 for Phase 2. The factory binary includes everything needed for a bootable device. OTA and littlefs partitions will be populated by the Meshtastic firmware itself on first boot.

3. **MD5 verification implementation**
   - What we know: esptool.js provides `flashMd5sum(address, size)` which reads the flash and returns MD5. FlashOptions accepts an optional `calculateMD5Hash` callback.
   - What's unclear: Whether `calculateMD5Hash` is computed automatically if provided, or if we need to implement MD5 hash computation ourselves. Browser's `crypto.subtle` only supports SHA, not MD5.
   - Recommendation: Use a lightweight MD5 implementation (or compute using esptool.js internal utilities if available). The verification step is important per CONTEXT.md (verification failure = flash failure, full retry). If MD5 calculation is problematic, compare by re-reading a sample of flash sectors as an alternative verification approach.

4. **Firmware file serving strategy for development**
   - What we know: FLSH-05 says "vendored into Docker image." Phase 4 handles Docker vendoring. Phase 2 needs firmware accessible from the app.
   - What's unclear: Whether to download firmware binaries manually into `public/firmware/` or create a script to fetch them.
   - Recommendation: Create a simple `scripts/download-firmware.sh` that fetches the pinned version's firmware zip from Meshtastic GitHub releases, extracts factory binaries for supported devices, and places them in `public/firmware/`. This script would be run manually during development and automated in the Phase 4 Docker build.

## Sources

### Primary (HIGH confidence)
- [esptool-js GitHub repository](https://github.com/espressif/esptool-js) - API, version (v0.5.6), TypeScript source
- [esptool-js API documentation](https://espressif.github.io/esptool-js/docs/) - FlashOptions interface, ESPLoader class, Transport class
- [esptool-js releases](https://github.com/espressif/esptool-js/releases) - Version history, v0.5.6 latest
- [FlashOptions interface docs](https://espressif.github.io/esptool-js/docs/interfaces/FlashOptions.html) - Complete FlashOptions specification
- [ESPLoader class docs](https://espressif.github.io/esptool-js/docs/classes/ESPLoader.html) - Complete method signatures
- [Meshtastic firmware device-install.sh](https://github.com/meshtastic/firmware/blob/master/bin/device-install.sh) - Flash addresses: factory at 0x0, OTA at 0x260000, littlefs at 0x300000
- [Web Serial API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) - API specification, browser support

### Secondary (MEDIUM confidence)
- [Meshtastic web-flasher GitHub](https://github.com/meshtastic/web-flasher) - Reference implementation using esptool.js in production
- [Meshtastic web-flasher firmwareStore](https://github.com/meshtastic/web-flasher/blob/main/stores/firmwareStore.ts) - Flash flow patterns: FlashOptions configuration, progress tracking, post-flash reset
- [@types/w3c-web-serial npm](https://www.npmjs.com/package/@types/w3c-web-serial) - TypeScript types for Web Serial, v1.0.8
- [ESP32 flash address documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/flashing-firmware.html) - Standard ESP32 flash layout
- [esptool-js ESP32-C3 USB-JTAG fix](https://github.com/espressif/esptool-js/issues/41) - Issue resolved in stub binary update (PR #54)

### Tertiary (LOW confidence)
- [Meshtastic firmware build script](https://github.com/meshtastic/firmware/blob/master/bin/build-esp32.sh) - Factory binary naming convention (`firmware-{device}-{version}.factory.bin`)
- Meshtastic firmware `.mt.json` metadata format - file list, offsets, checksums (inferred from web-flasher source, not verified against actual release files)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - esptool.js is the canonical library, verified from official GitHub repo and API docs
- Architecture: HIGH - Patterns derived from official examples and production Meshtastic web-flasher
- Pitfalls: HIGH - Common issues documented in esptool-js GitHub issues, ESP32 troubleshooting docs, and Meshtastic community
- Flash addresses: MEDIUM - Factory binary at 0x0 confirmed from device-install.sh, but exact file contents of .factory.bin format inferred

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- esptool.js has regular but non-breaking releases)
