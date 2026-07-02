"use client";

import { Button, Chip, Spinner } from "@heroui/react";
import { CheckCircle2, Usb, ArrowRight } from "lucide-react";
import type { DeviceHardware } from "@/types/device";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";
import { ConnectionStatus } from "@/components/connect/connection-status";
import { ChipMismatchWarning } from "@/components/connect/chip-mismatch";
import { BootloaderHelp } from "@/components/connect/bootloader-help";
import type { SerialConnectionState, ChipInfo, ConsoleEntry } from "@/types/serial";
import type { DfuConnectionState } from "@/hooks/use-dfu";
import type { DfuDevice } from "@/lib/web-dfu";

/** Subset of UseSerialReturn that ConnectStep consumes */
interface SerialState {
  connectionState: SerialConnectionState;
  chipInfo: ChipInfo | null;
  error: string | null;
  consoleLogs: ConsoleEntry[];
  isConnecting: boolean;
  isConnected: boolean;
  connect: () => Promise<void>;
  clearError: () => void;
}

/** Subset of UseDfuReturn that ConnectStep consumes */
interface DfuState {
  connectionState: DfuConnectionState;
  dfuDevice: DfuDevice | null;
  error: string | null;
  consoleLogs: ConsoleEntry[];
  isConnecting: boolean;
  isConnected: boolean;
  connect: () => Promise<void>;
  clearError: () => void;
}

/**
 * Discriminated transport union: `family` narrows which transport handle is
 * present. Both families share the same 4-state connection machine
 * ("disconnected" | "connecting" | "connected" | "error") so state reads are
 * uniform; family-specific surface (chip name for ESP32, USB VID/PID for
 * nRF52) is handled in the family-conditional views below.
 *
 * Per CONTEXT Decision 1: discriminated union, NOT two mutually-exclusive
 * optional props — the compiler fails fast on family mismatch.
 */
export type TransportState =
  | { family: "esp32"; serial: SerialState }
  | { family: "nrf52"; dfu: DfuState };

interface ConnectStepProps {
  device: DeviceHardware | null;
  transport: TransportState;
  /** ESP32 chip-vs-architecture mismatch. Not applicable to nRF52 (DFU exposes
   *  no esptool-style chip identifier), so this prop is optional. */
  chipMismatch?: boolean;
  skipFlash?: boolean;
  onContinue: () => void;
}

const ARCH_COLORS: Record<string, "primary" | "secondary" | "warning" | "success"> = {
  esp32: "primary",
  "esp32-s3": "secondary",
  "esp32-c3": "warning",
  "esp32-c6": "success",
};

/**
 * Connect-step error categories (Phase 19-02 / BRND-02).
 *
 * The classifier is family-agnostic — it maps both esptool-side (Web Serial)
 * and DFU-side (Web USB) error strings into the same four buckets so the
 * ConnectStep UI can render one shared error panel + Try Again flow.
 *
 * useSerial and useDfu both route DOMException.NotAllowedError (user
 * cancelled the browser picker) back to "disconnected" without touching
 * error state, so the 'cancelled' branch below is defensive belt-and-braces
 * for hook-shape drift (e.g. a future hook that surfaces "No port selected"
 * as an error string).
 *
 * DFU string coverage (Task 25-01-03 / FLSH-10):
 * - `SecurityError` / `Web USB access denied` → in-use  (HTTPS or another
 *   app has the device)
 * - `Could not claim the DFU interface` → in-use  (another process holds it)
 * - `transferOut failed` / `transferIn failed` → no-response  (control
 *   transfer stalled — device unplugged or wedged bootloader)
 * - `USB device disconnected` / `USB connection lost` → no-response
 * - `Not opened` / `Not claimed` / raw `DFU error: …` fall through to
 *   generic (deliberate — those strings offer no actionable hint the
 *   generic copy can't match).
 *
 * @example classifyConnectError("SecurityError: access denied")
 *   → "in-use" — HTTPS gate or another app holds the port.
 * @example classifyConnectError("transferOut failed: device was disconnected")
 *   → "no-response" — DFU control transfer aborted mid-write.
 * @example classifyConnectError("Could not claim the DFU interface. Close any other apps talking to the device")
 *   → "in-use" — another tool (nrfutil, uf2conv, second tab) holds the USB interface.
 */
type ConnectErrorCategory = "cancelled" | "in-use" | "no-response" | "generic";

function classifyConnectError(err: string | null): ConnectErrorCategory {
  if (!err) return "generic";
  const lower = err.toLowerCase();
  if (
    lower.includes("no device selected") ||
    lower.includes("no port selected") ||
    lower.includes("cancel") ||
    lower.includes("user aborted") ||
    lower.includes("user did not select")
  ) {
    return "cancelled";
  }
  if (
    lower.includes("close any other apps") ||
    lower.includes("in use by another") ||
    lower.includes("already in use") ||
    lower.includes("invalidstateerror") ||
    lower.includes("access denied") ||
    lower.includes("permission denied") ||
    lower.includes("busy") ||
    // DFU-side matches (Task 25-01-03)
    lower.includes("securityerror") ||
    lower.includes("could not claim") ||
    lower.includes("unable to claim")
  ) {
    return "in-use";
  }
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("no compatible device") ||
    lower.includes("networkerror") ||
    lower.includes("no response") ||
    lower.includes("did not respond") ||
    lower.includes("didn't respond") ||
    lower.includes("failed to open") ||
    lower.includes("failed to connect") ||
    lower.includes("no serial port") ||
    // DFU-side matches (Task 25-01-03)
    lower.includes("transferout failed") ||
    lower.includes("transferin failed") ||
    lower.includes("device disconnected") ||
    lower.includes("device was disconnected") ||
    lower.includes("usb connection lost") ||
    lower.includes("usb device disconnected")
  ) {
    return "no-response";
  }
  return "generic";
}

function categoryMessage(
  category: ConnectErrorCategory,
  raw: string | null,
  family: "esp32" | "nrf52" = "esp32"
): string | null {
  switch (category) {
    case "cancelled":
      // Silent — Connect step reverts to "ready" UI.
      return null;
    case "in-use":
      return family === "nrf52"
        ? "The DFU interface is in use by another program (nrfutil, uf2conv, or another browser tab running the flasher). Close it and try again."
        : "The serial port is in use by another program (Arduino IDE, PlatformIO, or another browser tab running the flasher). Close it and try again.";
    case "no-response":
      return family === "nrf52"
        ? "Couldn't reach the device. Try a different data USB cable (some are charge-only), or put the device in bootloader mode (double-tap RESET) using the steps below."
        : "Couldn't reach the device. Try a different data USB cable (some are charge-only), or put the device in bootloader mode using the steps below.";
    case "generic":
    default:
      return (
        raw ??
        (family === "nrf52"
          ? "DFU connection failed. Try the troubleshooting steps below."
          : "Serial connection failed. Try the troubleshooting steps below.")
      );
  }
}

/**
 * Top-level dispatcher. Narrows the discriminated `transport` union and
 * hands off to a per-family view. The ESP32 view is byte-identical to the
 * pre-refactor ConnectStep body (regression guard for SC5); the nRF52 view
 * is the parallel DFU render path.
 */
export function ConnectStep({
  device,
  transport,
  chipMismatch,
  skipFlash,
  onContinue,
}: ConnectStepProps) {
  if (transport.family === "esp32") {
    return (
      <Esp32ConnectView
        device={device}
        serial={transport.serial}
        chipMismatch={chipMismatch ?? false}
        skipFlash={skipFlash}
        onContinue={onContinue}
      />
    );
  }
  return (
    <Nrf52ConnectView
      device={device}
      dfu={transport.dfu}
      skipFlash={skipFlash}
      onContinue={onContinue}
    />
  );
}

// ---- ESP32 view (byte-identical to pre-refactor ConnectStep) --------------

interface Esp32ConnectViewProps {
  device: DeviceHardware | null;
  serial: SerialState;
  chipMismatch: boolean;
  skipFlash?: boolean;
  onContinue: () => void;
}

function Esp32ConnectView({
  device,
  serial,
  chipMismatch,
  skipFlash,
  onContinue,
}: Esp32ConnectViewProps) {
  const imagePath = device ? getDeviceImagePath(device) : null;
  const archLabel = device ? getArchLabel(device) : null;
  const archColor = device ? (ARCH_COLORS[device.architecture] || "primary") : "primary";

  const handleRetry = async () => {
    serial.clearError();
    await serial.connect();
  };

  const isConnected = serial.connectionState === "connected";

  // Classify serial errors into actionable categories (Phase 19-02 / BRND-02).
  const errorCategory: ConnectErrorCategory | null =
    serial.connectionState === "error"
      ? classifyConnectError(serial.error)
      : null;
  const isCancelled = errorCategory === "cancelled";
  const displayError =
    errorCategory && !isCancelled
      ? categoryMessage(errorCategory, serial.error)
      : null;
  // Treat cancellation as "ready to reconnect" — hook already routes real
  // browser-picker cancels to "disconnected"; this handles the string-fallback path.
  const showErrorPanel = serial.connectionState === "error" && !isCancelled;

  return (
    <div className="space-y-4">
      {/* Panel: left status | center spacer | right device image */}
      <div className={`glass-card rounded-xl p-6 transition-all duration-500 ${isConnected ? "border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]" : ""}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
          {/* Left: connection state */}
          <div className="min-w-0">
            {(serial.connectionState === "disconnected" || isCancelled) && (
              <div className="space-y-1">
                <p className="text-sm font-mono text-default-400">
                  Ready to connect
                </p>
                <p className="text-xs text-default-600">
                  Plug in USB, then click Connect
                </p>
              </div>
            )}

            {serial.connectionState === "connecting" && (
              <div className="flex items-center gap-3">
                <Spinner size="sm" color="primary" />
                <p className="text-sm font-mono text-default-400">
                  Connecting...
                </p>
              </div>
            )}

            {isConnected && serial.chipInfo && (
              <ConnectionStatus chipInfo={serial.chipInfo} />
            )}

            {showErrorPanel && (
              <p className="text-sm text-danger font-mono line-clamp-3">
                {displayError}
              </p>
            )}
          </div>

          {/* Center: spacer */}
          <div className="flex-shrink-0" />

          {/* Right: device image + name (hidden when no device, e.g. URL jump) */}
          {device && imagePath ? (
            <div className={`flex flex-col items-center gap-2 justify-self-end transition-opacity duration-500 ${isConnected ? "opacity-100" : "opacity-40"}`}>
              <div className="w-[140px] h-[100px] flex items-center justify-center rounded-lg bg-default-100/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePath}
                  alt={device.displayName}
                  className="max-h-full max-w-full object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="font-mono text-sm text-default-500">
                  {device.displayName}
                </span>
                <Chip size="sm" variant="flat" color={archColor}>
                  {archLabel}
                </Chip>
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>

        {/* Chip mismatch warning below the row */}
        {isConnected && chipMismatch && serial.chipInfo && device && (
          <div className="mt-4">
            <ChipMismatchWarning
              detectedChipName={serial.chipInfo.chipName}
              expectedArchitecture={device.architecture}
              deviceName={device.displayName}
            />
          </div>
        )}
      </div>

      {/* Action buttons — below the panel */}
      <div className="flex justify-center">
        {(serial.connectionState === "disconnected" || isCancelled) && (
          <Button
            color="primary"
            size="lg"
            startContent={<Usb className="w-5 h-5" />}
            onPress={() => (isCancelled ? handleRetry() : serial.connect())}
            className="font-mono whitespace-nowrap"
          >
            Connect Device
          </Button>
        )}

        {serial.connectionState === "connecting" && (
          <Button
            color="primary"
            size="lg"
            isDisabled
            className="font-mono whitespace-nowrap"
          >
            Connecting...
          </Button>
        )}

        {isConnected && !chipMismatch && (
          <Button
            color="primary"
            size="lg"
            endContent={<ArrowRight className="w-5 h-5" />}
            onPress={onContinue}
            className="font-mono whitespace-nowrap cta-pulse"
          >
            {skipFlash ? 'Continue to Configure' : 'Continue to Flash'}
          </Button>
        )}

        {showErrorPanel && (
          <Button
            color="primary"
            variant="bordered"
            size="lg"
            onPress={handleRetry}
            className="font-mono whitespace-nowrap"
          >
            Try Again
          </Button>
        )}
      </div>

      {/* Bootloader help — surfaced on any non-cancelled error. */}
      {showErrorPanel && <BootloaderHelp family="esp32" />}
    </div>
  );
}

// ---- nRF52 view (parallel DFU render path) --------------------------------

interface Nrf52ConnectViewProps {
  device: DeviceHardware | null;
  dfu: DfuState;
  skipFlash?: boolean;
  onContinue: () => void;
}

/**
 * Format a USB vendor/product ID pair as a canonical `VID:PID` hex string
 * (e.g. `239a:0029` for a Seeed T-1000E in Adafruit DFU mode).
 */
function formatVidPid(vendorId: number, productId: number): string {
  const vid = vendorId.toString(16).padStart(4, "0");
  const pid = productId.toString(16).padStart(4, "0");
  return `${vid}:${pid}`;
}

function Nrf52ConnectView({
  device,
  dfu,
  skipFlash,
  onContinue,
}: Nrf52ConnectViewProps) {
  const imagePath = device ? getDeviceImagePath(device) : null;
  const archLabel = device ? getArchLabel(device) : null;
  const archColor = device ? (ARCH_COLORS[device.architecture] || "primary") : "primary";

  const handleRetry = async () => {
    dfu.clearError();
    await dfu.connect();
  };

  const isConnected = dfu.connectionState === "connected";

  // Classify DFU errors using the shared category machine. Task 25-01-03
  // extends the classifier to cover DFU-specific strings.
  const errorCategory: ConnectErrorCategory | null =
    dfu.connectionState === "error" ? classifyConnectError(dfu.error) : null;
  const isCancelled = errorCategory === "cancelled";
  const displayError =
    errorCategory && !isCancelled
      ? categoryMessage(errorCategory, dfu.error, "nrf52")
      : null;
  const showErrorPanel = dfu.connectionState === "error" && !isCancelled;

  const vidPid =
    dfu.dfuDevice != null
      ? formatVidPid(dfu.dfuDevice.vendorId, dfu.dfuDevice.productId)
      : null;

  return (
    <div className="space-y-4">
      {/* Panel: left status | center spacer | right device image */}
      <div className={`glass-card rounded-xl p-6 transition-all duration-500 ${isConnected ? "border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]" : ""}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
          {/* Left: connection state */}
          <div className="min-w-0">
            {(dfu.connectionState === "disconnected" || isCancelled) && (
              <div className="space-y-1">
                <p className="text-sm font-mono text-default-400">
                  Ready to connect (DFU)
                </p>
                <p className="text-xs text-default-600">
                  Double-tap RESET on the device, then click Connect
                </p>
              </div>
            )}

            {dfu.connectionState === "connecting" && (
              <div className="flex items-center gap-3">
                <Spinner size="sm" color="primary" />
                <p className="text-sm font-mono text-default-400">
                  Claiming DFU interface...
                </p>
              </div>
            )}

            {isConnected && vidPid && (
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="flex-shrink-0 relative">
                  <CheckCircle2 className="w-8 h-8 text-teal-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal-400 animate-pulse" />
                </div>
                <div className="space-y-1 min-w-0">
                  <h3 className="font-mono text-lg text-teal-400">
                    Connected (DFU)
                  </h3>
                  <div className="space-y-0.5 text-sm">
                    <p>
                      <span className="text-default-400">USB:</span>{" "}
                      <span className="font-mono text-default-300">
                        {vidPid}
                      </span>
                    </p>
                    <p className="truncate">
                      <span className="text-default-400">Interface:</span>{" "}
                      <span className="font-mono text-default-300">
                        DFU 1.1 (class 0xFE / subclass 0x01)
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {showErrorPanel && (
              <p className="text-sm text-danger font-mono line-clamp-3">
                {displayError}
              </p>
            )}
          </div>

          {/* Center: spacer */}
          <div className="flex-shrink-0" />

          {/* Right: device image + name (hidden when no device, e.g. URL jump) */}
          {device && imagePath ? (
            <div className={`flex flex-col items-center gap-2 justify-self-end transition-opacity duration-500 ${isConnected ? "opacity-100" : "opacity-40"}`}>
              <div className="w-[140px] h-[100px] flex items-center justify-center rounded-lg bg-default-100/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePath}
                  alt={device.displayName}
                  className="max-h-full max-w-full object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="font-mono text-sm text-default-500">
                  {device.displayName}
                </span>
                <Chip size="sm" variant="flat" color={archColor}>
                  {archLabel}
                </Chip>
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>
      </div>

      {/* Action buttons — below the panel */}
      <div className="flex justify-center">
        {(dfu.connectionState === "disconnected" || isCancelled) && (
          <Button
            color="primary"
            size="lg"
            startContent={<Usb className="w-5 h-5" />}
            onPress={() => (isCancelled ? handleRetry() : dfu.connect())}
            className="font-mono whitespace-nowrap"
          >
            Connect Device
          </Button>
        )}

        {dfu.connectionState === "connecting" && (
          <Button
            color="primary"
            size="lg"
            isDisabled
            className="font-mono whitespace-nowrap"
          >
            Connecting...
          </Button>
        )}

        {isConnected && (
          <Button
            color="primary"
            size="lg"
            endContent={<ArrowRight className="w-5 h-5" />}
            onPress={onContinue}
            className="font-mono whitespace-nowrap cta-pulse"
          >
            {skipFlash ? 'Continue to Configure' : 'Continue to Flash'}
          </Button>
        )}

        {showErrorPanel && (
          <Button
            color="primary"
            variant="bordered"
            size="lg"
            onPress={handleRetry}
            className="font-mono whitespace-nowrap"
          >
            Try Again
          </Button>
        )}
      </div>

      {/* Bootloader help — surfaced on any non-cancelled error. */}
      {showErrorPanel && <BootloaderHelp family="nrf52" />}
    </div>
  );
}
