"use client";

import { Button, Chip, Spinner } from "@heroui/react";
import { Usb, ArrowRight } from "lucide-react";
import type { DeviceHardware } from "@/types/device";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";
import { ConnectionStatus } from "@/components/connect/connection-status";
import { ChipMismatchWarning } from "@/components/connect/chip-mismatch";
import { BootloaderHelp } from "@/components/connect/bootloader-help";
import type { SerialConnectionState, ChipInfo, ConsoleEntry } from "@/types/serial";

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

interface ConnectStepProps {
  device: DeviceHardware | null;
  serial: SerialState;
  chipMismatch: boolean;
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
 * Serial-connect error categories (Phase 19-02 / BRND-02).
 *
 * useSerial already routes DOMException.NotAllowedError (user cancelled the
 * browser port picker) back to "disconnected" without touching error state,
 * so the 'cancelled' branch below is defensive belt-and-braces for
 * hook-shape drift (e.g. a future hook that surfaces "No port selected"
 * as an error string).
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
    lower.includes("busy")
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
    lower.includes("no serial port")
  ) {
    return "no-response";
  }
  return "generic";
}

function categoryMessage(
  category: ConnectErrorCategory,
  raw: string | null
): string | null {
  switch (category) {
    case "cancelled":
      // Silent — Connect step reverts to "ready" UI.
      return null;
    case "in-use":
      return "The serial port is in use by another program (Arduino IDE, PlatformIO, or another browser tab running the flasher). Close it and try again.";
    case "no-response":
      return "Couldn't reach the device. Try a different data USB cable (some are charge-only), or put the device in bootloader mode using the steps below.";
    case "generic":
    default:
      return (
        raw ??
        "Serial connection failed. Try the troubleshooting steps below."
      );
  }
}

export function ConnectStep({
  device,
  serial,
  chipMismatch,
  skipFlash,
  onContinue,
}: ConnectStepProps) {
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
      {showErrorPanel && <BootloaderHelp />}
    </div>
  );
}
