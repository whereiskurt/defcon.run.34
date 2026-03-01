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
  onContinue: () => void;
}

const ARCH_COLORS: Record<string, "primary" | "secondary" | "warning" | "success"> = {
  esp32: "primary",
  "esp32-s3": "secondary",
  "esp32-c3": "warning",
  "esp32-c6": "success",
};

export function ConnectStep({
  device,
  serial,
  chipMismatch,
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

  return (
    <div className="space-y-4">
      {/* Panel: left status | center spacer | right device image */}
      <div className={`glass-card rounded-xl p-6 transition-all duration-500 ${isConnected ? "border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]" : ""}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
          {/* Left: connection state */}
          <div className="min-w-0">
            {serial.connectionState === "disconnected" && (
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

            {serial.connectionState === "error" && (
              <p className="text-sm text-danger font-mono line-clamp-2">
                {serial.error}
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
        {serial.connectionState === "disconnected" && (
          <Button
            color="primary"
            size="lg"
            startContent={<Usb className="w-5 h-5" />}
            onPress={() => serial.connect()}
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
            Continue to Flash
          </Button>
        )}

        {serial.connectionState === "error" && (
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

      {/* Bootloader help — only on error, below the panel */}
      {serial.connectionState === "error" && <BootloaderHelp />}
    </div>
  );
}
