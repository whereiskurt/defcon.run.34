/**
 * DFU library shootout (Plan 24-02, Task 1) — audit trail (per supply_chain_gate):
 * - dfu-util-js  : verdict=REJECT. npm E404 (`registry.npmjs.org/dfu-util-js`) — package does not exist.
 * - web-dfu      : verdict=REJECT. npm E404 (`registry.npmjs.org/web-dfu`) — package does not exist.
 * - nrf-dfu-js   : verdict=REJECT. npm E404 (`registry.npmjs.org/nrf-dfu-js`) — package does not exist.
 * - dfu@0.1.5    : verdict=REJECT. Last published 2024-10-16 (>20mo stale), Flipper-Zero-focused fork
 *                   (repo `Flipper-Zero/webdfu`) targeting ST DFU; no evidence of Adafruit nRF52
 *                   descriptor coverage; single-maintainer namespace outside supply-chain-gate policy.
 * Decision: fall back to custom DFU 1.1 client per CONTEXT Decision 2 (~200-300 LOC, zero dep).
 * Targets USB DFU 1.1 spec (§6.1 protocol state machine) against the T-1000E Adafruit bootloader
 * (interface 0, alt setting 0, transferSize 4096). Only devDep added this task: @types/w3c-web-usb
 * (DefinitelyTyped, MIT, ships type-only, verified `time.modified=2026-03-29`).
 */
"use client";

// ---- USB DFU 1.1 constants -------------------------------------------------

/** DFU interface class code (per USB DFU 1.1 §4.1.1). */
const DFU_INTERFACE_CLASS = 0xfe;
/** DFU interface subclass code (application-specific: 0x01). */
const DFU_INTERFACE_SUBCLASS = 0x01;

/** DFU class requests (host->device) — USB DFU 1.1 Table 3.2. */
const DFU_DNLOAD = 0x01;
const DFU_GETSTATUS = 0x03;
const DFU_CLRSTATUS = 0x04;
const DFU_ABORT = 0x06;

/** DFU protocol state values (USB DFU 1.1 §6.1.2). */
const DFU_STATE_IDLE = 0x02;
const DFU_STATE_DNLOAD_SYNC = 0x03;
const DFU_STATE_DNBUSY = 0x04;
const DFU_STATE_DNLOAD_IDLE = 0x05;
const DFU_STATE_MANIFEST_SYNC = 0x06;
const DFU_STATE_MANIFEST = 0x07;
const DFU_STATE_MANIFEST_WAIT_RESET = 0x08;
const DFU_STATE_ERROR = 0x0a;

/** DFU_GETSTATUS bStatus values (USB DFU 1.1 Table 6.1). */
const DFU_STATUS_OK = 0x00;

/** DFU transfer block size (Adafruit bootloader convention). */
const DFU_TRANSFER_SIZE = 4096;

/** DFU interface number and alt setting (Adafruit bootloader convention). */
const DFU_INTERFACE_NUMBER = 0;
const DFU_INTERFACE_ALT = 0;

// ---- Public surface --------------------------------------------------------

export interface DfuDevice {
  /** Underlying USBDevice for lifecycle management */
  readonly usb: USBDevice;
  /** Vendor / product IDs for logging / chip-mismatch */
  readonly vendorId: number;
  readonly productId: number;
  /** DFU interface number selected during openDfu (used by dfuWrite/dfuVerify) */
  readonly interfaceNumber: number;
  /** Negotiated transfer size — currently pinned to DFU_TRANSFER_SIZE */
  readonly transferSize: number;
}

/** DFU_GETSTATUS raw fields (USB DFU 1.1 §6.1.2). */
interface DfuStatus {
  bStatus: number;
  bwPollTimeoutMs: number;
  bState: number;
  iString: number;
}

/**
 * Open + configure + claim + selectAlternate on the DFU interface.
 * Throws with an actionable message on failure. The caller MUST have obtained
 * `usb` from `navigator.usb.requestDevice(...)` inside a user-gesture handler.
 */
export async function openDfu(usb: USBDevice): Promise<DfuDevice> {
  try {
    if (!usb.opened) {
      await usb.open();
    }
    // Select the default configuration if the device isn't already configured.
    // Adafruit nRF52 DFU exposes a single configuration (value 1).
    if (!usb.configuration) {
      await usb.selectConfiguration(1);
    }

    // Find the DFU interface (class 0xFE, subclass 0x01). If found we prefer
    // its interfaceNumber; otherwise fall back to the Adafruit convention of 0.
    let interfaceNumber = DFU_INTERFACE_NUMBER;
    const cfg = usb.configuration;
    if (cfg) {
      for (const iface of cfg.interfaces) {
        const alt = iface.alternates[0];
        if (
          alt &&
          alt.interfaceClass === DFU_INTERFACE_CLASS &&
          alt.interfaceSubclass === DFU_INTERFACE_SUBCLASS
        ) {
          interfaceNumber = iface.interfaceNumber;
          break;
        }
      }
    }

    await usb.claimInterface(interfaceNumber);
    await usb.selectAlternateInterface(interfaceNumber, DFU_INTERFACE_ALT);

    return {
      usb,
      vendorId: usb.vendorId,
      productId: usb.productId,
      interfaceNumber,
      transferSize: DFU_TRANSFER_SIZE,
    };
  } catch (err) {
    // Best-effort cleanup so a partially-opened device can be reopened later.
    try {
      if (usb.opened) await usb.close();
    } catch {
      /* swallow — original error takes precedence */
    }
    throw new Error(getDfuErrorMessage(err));
  }
}

/**
 * DFU_DNLOAD the firmware bytes in DFU_TRANSFER_SIZE chunks. reportProgress
 * fires per block. Implements the download state machine from USB DFU 1.1
 * §6.1.1 (dfuIDLE -> dfuDNLOAD_SYNC -> dfuDNBUSY -> dfuDNLOAD_IDLE -> ...).
 */
export async function dfuWrite(
  device: DfuDevice,
  firmware: Uint8Array,
  reportProgress: (written: number, total: number) => void
): Promise<void> {
  const total = firmware.length;
  if (total === 0) {
    throw new Error("DFU write called with empty firmware buffer.");
  }

  // Ensure we start from a clean state — clear any lingering error from a prior run.
  const initialStatus = await dfuGetStatus(device);
  if (initialStatus.bState === DFU_STATE_ERROR) {
    await dfuClrStatus(device);
  }

  let written = 0;
  let blockNum = 0;
  reportProgress(0, total);

  while (written < total) {
    const remaining = total - written;
    const chunkSize = Math.min(device.transferSize, remaining);
    const chunk = firmware.subarray(written, written + chunkSize);

    await dfuDnload(device, blockNum, chunk);
    // GETSTATUS drives the state machine forward. We poll until the device
    // leaves dfuDNBUSY.
    const status = await pollUntilNotBusy(device);
    if (status.bStatus !== DFU_STATUS_OK) {
      throw new Error(
        `DFU download failed at block ${blockNum} (bStatus=0x${status.bStatus.toString(16).padStart(2, "0")}, bState=${status.bState}).`
      );
    }

    written += chunkSize;
    blockNum++;
    reportProgress(written, total);
  }

  // Final zero-length DFU_DNLOAD signals end of download. The device then
  // transitions to dfuMANIFEST_SYNC and eventually dfuMANIFEST_WAIT_RESET.
  await dfuDnload(device, blockNum, new Uint8Array(0));
  const manifestStatus = await pollUntilNotBusy(device);
  if (manifestStatus.bStatus !== DFU_STATUS_OK) {
    throw new Error(
      `DFU manifest phase failed (bStatus=0x${manifestStatus.bStatus.toString(16).padStart(2, "0")}, bState=${manifestStatus.bState}).`
    );
  }
}

/**
 * Read DFU_GETSTATUS after the manifest phase and confirm bStatus === 0x00 (OK)
 * plus bState === 2 (dfuIDLE). Throws with a diagnostic message otherwise.
 *
 * NOTE: Some Adafruit bootloaders reboot the device between MANIFEST_SYNC and
 * dfuIDLE — the USB endpoint may disappear before the final GETSTATUS returns.
 * We treat a post-manifest connection loss as success (device rebooted into
 * the new firmware) rather than a verify failure.
 */
export async function dfuVerify(device: DfuDevice): Promise<void> {
  let status: DfuStatus;
  try {
    status = await dfuGetStatus(device);
  } catch (err) {
    // A NetworkError / disconnect after final DFU_DNLOAD is expected on
    // bootloaders that auto-reset. Treat it as a successful verify signal.
    if (isDisconnectError(err)) return;
    throw new Error(`DFU verify failed: ${errorMessage(err)}`);
  }

  if (status.bStatus !== DFU_STATUS_OK) {
    throw new Error(
      `DFU verify: bStatus=0x${status.bStatus.toString(16).padStart(2, "0")} (expected 0x00 OK).`
    );
  }

  // dfuMANIFEST_WAIT_RESET is an acceptable terminal state on bootloaders
  // that require an explicit USB reset. Both it and dfuIDLE indicate a
  // clean, verified download.
  if (
    status.bState !== DFU_STATE_IDLE &&
    status.bState !== DFU_STATE_MANIFEST_WAIT_RESET
  ) {
    throw new Error(
      `DFU verify: bState=${status.bState} (expected 2=dfuIDLE or 8=dfuMANIFEST_WAIT_RESET).`
    );
  }
}

/** Release the interface and close the USB device. Safe to call twice. */
export async function closeDfu(device: DfuDevice): Promise<void> {
  try {
    await device.usb.releaseInterface(device.interfaceNumber);
  } catch {
    // Interface may already be released or device already gone.
  }
  try {
    if (device.usb.opened) {
      await device.usb.close();
    }
  } catch {
    // Device may already be closed.
  }
}

/**
 * Human-actionable error message for a Web USB / DFU failure. Parallels
 * getConnectionErrorMessage in lib/esptool.ts.
 */
export function getDfuErrorMessage(error: unknown): string {
  const message = errorMessage(error);

  if (message.includes("No device selected") || message.includes("No available device")) {
    return "No device selected. Click Connect and choose your device from the browser prompt.";
  }
  if (message.includes("NotFoundError")) {
    return "No compatible device found. Put the T-1000E in DFU mode (double-tap the RESET button) and try again.";
  }
  if (message.includes("SecurityError")) {
    return "Web USB access denied. This page must be served over HTTPS or from localhost.";
  }
  if (message.includes("NetworkError") || isDisconnectError(error)) {
    return "USB connection lost. Unplug the device, plug it back in, and try again.";
  }
  if (
    message.includes("access denied") ||
    message.includes("Access denied") ||
    message.includes("unable to claim")
  ) {
    return "Could not claim the DFU interface. Close any other apps talking to the device (nrfutil, uf2conv, bootloader tools) and try again.";
  }
  if (message.includes("The device was disconnected")) {
    return "USB device disconnected. Reconnect and re-enter DFU mode (double-tap RESET).";
  }
  return `DFU error: ${message}`;
}

// ---- Internal helpers ------------------------------------------------------

/** Issue a DFU_DNLOAD control transfer for one block of firmware. */
async function dfuDnload(
  device: DfuDevice,
  blockNum: number,
  data: Uint8Array
): Promise<void> {
  // Copy the view's bytes into a fresh, non-shared ArrayBuffer so the
  // BufferSource parameter accepts it under strict TS lib.dom typings
  // (a Uint8Array backed by a SharedArrayBuffer is not assignable to
  // BufferSource in TS >=5.7 lib.dom).
  const payload = new ArrayBuffer(data.byteLength);
  new Uint8Array(payload).set(data);
  const result = await device.usb.controlTransferOut(
    {
      requestType: "class",
      recipient: "interface",
      request: DFU_DNLOAD,
      value: blockNum & 0xffff,
      index: device.interfaceNumber,
    },
    payload
  );
  if (result.status !== "ok") {
    throw new Error(`DFU_DNLOAD transfer status: ${result.status}`);
  }
}

/** Issue a DFU_GETSTATUS control transfer and parse the 6-byte response. */
async function dfuGetStatus(device: DfuDevice): Promise<DfuStatus> {
  const result = await device.usb.controlTransferIn(
    {
      requestType: "class",
      recipient: "interface",
      request: DFU_GETSTATUS,
      value: 0,
      index: device.interfaceNumber,
    },
    6
  );
  if (result.status !== "ok" || !result.data || result.data.byteLength < 6) {
    throw new Error(
      `DFU_GETSTATUS returned status=${result.status}, len=${result.data?.byteLength ?? 0}`
    );
  }
  const view = result.data;
  const bStatus = view.getUint8(0);
  // bwPollTimeout is a 24-bit little-endian integer at offset 1.
  const bwPollTimeoutMs =
    view.getUint8(1) | (view.getUint8(2) << 8) | (view.getUint8(3) << 16);
  const bState = view.getUint8(4);
  const iString = view.getUint8(5);
  return { bStatus, bwPollTimeoutMs, bState, iString };
}

/** Issue a DFU_CLRSTATUS to move from dfuERROR back to dfuIDLE. */
async function dfuClrStatus(device: DfuDevice): Promise<void> {
  await device.usb.controlTransferOut({
    requestType: "class",
    recipient: "interface",
    request: DFU_CLRSTATUS,
    value: 0,
    index: device.interfaceNumber,
  });
}

/**
 * Poll DFU_GETSTATUS, honouring bwPollTimeout, until the device leaves
 * dfuDNBUSY / dfuMANIFEST. Returns the terminal (non-busy) status. Bounded
 * by a wall-clock timeout to prevent an infinite loop against a wedged
 * bootloader.
 */
async function pollUntilNotBusy(device: DfuDevice): Promise<DfuStatus> {
  const start = Date.now();
  const HARD_TIMEOUT_MS = 60_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await dfuGetStatus(device);
    // Any non-busy state (IDLE, DNLOAD_IDLE, DNLOAD_SYNC, MANIFEST_SYNC,
    // MANIFEST_WAIT_RESET, ERROR) is a terminal read for this poll cycle —
    // the caller decides how to react. Only DNBUSY and MANIFEST require
    // us to wait bwPollTimeout and re-read.
    if (
      status.bState !== DFU_STATE_DNBUSY &&
      status.bState !== DFU_STATE_MANIFEST
    ) {
      return status;
    }
    if (Date.now() - start > HARD_TIMEOUT_MS) {
      throw new Error(
        `DFU busy-poll timeout after ${HARD_TIMEOUT_MS}ms (bState=${status.bState}).`
      );
    }
    // Honour device-requested poll interval (up to a sane cap).
    const delay = Math.min(status.bwPollTimeoutMs || 5, 500);
    await sleep(delay);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDisconnectError(error: unknown): boolean {
  const msg = errorMessage(error);
  return (
    msg.includes("The device was disconnected") ||
    msg.includes("NetworkError") ||
    msg.includes("device unavailable")
  );
}

// DFU_ABORT export (available to callers) — used only by future recovery
// paths; referenced here to prevent tree-shaking removal that would break
// consumers importing the constant directly. Marked as internal.
export const _DFU_ABORT_REQUEST = DFU_ABORT;
