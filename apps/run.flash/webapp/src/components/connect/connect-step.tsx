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
  device: DeviceHardware;
  serial: SerialState;
  chipMismatch: boolean;
  onContinue: () => void;
}

const ARCH_COLORS: Record<string, "primary" | "secondary" | "warning" | "success"> = {
  esp32: "primary",
  "esp32-s3": "secondary",
  "esp32-c3": "warning",
  "esp32-c6": "success",
};

/**
 * Connect wizard step: selected device confirmation, serial connection UI,
 * chip info display, bootloader help, and chip mismatch warning.
 *
 * Per CONTEXT.md locked decisions:
 * - Show selected device name and image at top as confirmation
 * - After connection: show status with manual "Continue to Flash" -- no auto-advance
 * - Connection failure: expandable troubleshooting section, hidden by default
 */
export function ConnectStep({
  device,
  serial,
  chipMismatch,
  onContinue,
}: ConnectStepProps) {
  const imagePath = getDeviceImagePath(device);
  const archLabel = getArchLabel(device);
  const archColor = ARCH_COLORS[device.architecture] || "primary";

  const handleRetry = async () => {
    serial.clearError();
    await serial.connect();
  };

  return (
    <div className="glass-card rounded-xl p-6 space-y-6">
      {/* Top section: Selected device confirmation */}
      <div className="flex flex-col items-center gap-3 pb-4 border-b border-default-200/20">
        <div className="h-20 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagePath}
            alt={device.displayName}
            className="max-h-20 max-w-full object-contain"
          />
        </div>
        <h2 className="font-mono text-lg text-default-200">
          {device.displayName}
        </h2>
        <Chip size="sm" variant="flat" color={archColor}>
          {archLabel}
        </Chip>
      </div>

      {/* Middle section: Connection state */}
      <div className="space-y-4">
        {/* Disconnected: Show connect button */}
        {serial.connectionState === "disconnected" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Button
              color="primary"
              size="lg"
              startContent={<Usb className="w-5 h-5" />}
              onPress={() => serial.connect()}
              className="font-mono"
            >
              Connect Device
            </Button>
            <p className="text-sm text-default-500 text-center max-w-sm">
              Click Connect and select your device from the browser&apos;s serial
              port dialog.
            </p>
          </div>
        )}

        {/* Connecting: Show spinner */}
        {serial.connectionState === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Spinner size="lg" color="primary" />
            <p className="text-sm font-mono text-default-400">Connecting...</p>
          </div>
        )}

        {/* Connected: Show status + continue or mismatch warning */}
        {serial.connectionState === "connected" && serial.chipInfo && (
          <div className="space-y-4">
            <ConnectionStatus chipInfo={serial.chipInfo} />

            {chipMismatch ? (
              <ChipMismatchWarning
                detectedChipName={serial.chipInfo.chipName}
                expectedArchitecture={device.architecture}
                deviceName={device.displayName}
              />
            ) : (
              <div className="flex justify-center pt-2">
                <Button
                  color="primary"
                  size="lg"
                  endContent={<ArrowRight className="w-5 h-5" />}
                  onPress={onContinue}
                  className="font-mono"
                >
                  Continue to Flash
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Error: Show error message + retry + bootloader help */}
        {serial.connectionState === "error" && (
          <div className="space-y-4">
            <div className="glass-card rounded-xl p-4 border-danger/30 bg-danger/5">
              <p className="text-sm text-danger font-mono">{serial.error}</p>
            </div>

            <div className="flex justify-center">
              <Button
                color="primary"
                variant="bordered"
                onPress={handleRetry}
                className="font-mono"
              >
                Try Again
              </Button>
            </div>

            <BootloaderHelp />
          </div>
        )}
      </div>
    </div>
  );
}
