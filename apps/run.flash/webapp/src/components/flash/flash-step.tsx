"use client";

import { Button } from "@heroui/react";
import {
  Zap,
  ArrowRight,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Chip } from "@heroui/react";
import type { DeviceHardware } from "@/types/device";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";
import type { ChipInfo, ConsoleEntry, FlashProgress } from "@/types/serial";
import { FIRMWARE_VERSION, getFactoryFilename } from "@/config/firmware";
import { FlashPipeline } from "@/components/flash/flash-pipeline";
import { FlashConsole } from "@/components/flash/flash-console";
import type { ESPLoader } from "esptool-js";

interface FlashStepProps {
  device: DeviceHardware;
  chipInfo: ChipInfo;
  flashState: {
    progress: FlashProgress;
    isFlashing: boolean;
    isComplete: boolean;
    isError: boolean;
    flash: (
      espLoader: ESPLoader,
      device: DeviceHardware,
      appendLog: (text: string) => void
    ) => Promise<void>;
    reset: () => void;
  };
  espLoaderRef: React.RefObject<ESPLoader | null>;
  consoleLogs: ConsoleEntry[];
  appendLog: (text: string) => void;
  onContinue: () => void;
  onRetry: () => void;
}

/**
 * Flash wizard step: pre-flash confirmation, staged pipeline visualization,
 * expandable console, success/failure states with retry flow.
 *
 * Per CONTEXT.md locked decisions:
 * - Manual flash start (no auto-start, no countdown)
 * - Clear erase warning before flash button
 * - Pre-flash info panel with device, chip, firmware details
 * - Recovery guidance with retry back to Connect step
 * - Flash success: all green checkmarks + "Continue to Configure"
 */
export function FlashStep({
  device,
  chipInfo,
  flashState,
  espLoaderRef,
  consoleLogs,
  appendLog,
  onContinue,
  onRetry,
}: FlashStepProps) {
  const { progress } = flashState;
  const isActive =
    progress.stage === "erasing" ||
    progress.stage === "writing" ||
    progress.stage === "verifying";

  const handleFlash = () => {
    if (!espLoaderRef.current) return;
    flashState.flash(espLoaderRef.current, device, appendLog);
  };

  const handleRetry = () => {
    flashState.reset();
    onRetry();
  };

  return (
    <div className="space-y-4">
      {/* Pre-flash confirmation (idle state) */}
      {progress.stage === "idle" && (
        <>
          {/* Top bar: erase warning + flash button on same plane */}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div>
                <p className="text-sm text-warning font-medium">
                  This will erase all existing firmware and data on the device
                </p>
                <p className="text-xs text-default-500">
                  Keep your USB cable connected during the flash process
                </p>
              </div>
            </div>
            <Button
              color="danger"
              size="lg"
              startContent={<Zap className="w-5 h-5" />}
              onPress={handleFlash}
              isDisabled={!espLoaderRef.current}
              className="font-mono whitespace-nowrap"
            >
              Flash Firmware
            </Button>
          </div>

          {/* Device details panel */}
          <div className="glass-card rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">Device</span>
              <span className="font-mono text-foreground">
                {device.displayName}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">Chip</span>
              <span className="font-mono text-foreground">
                {chipInfo.chipName}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">Firmware</span>
              <span className="font-mono text-foreground">
                {FIRMWARE_VERSION}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">File</span>
              <span className="font-mono text-foreground text-xs">
                {getFactoryFilename(device)}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">Flash address</span>
              <span className="font-mono text-foreground">
                0x0 (factory image)
              </span>
            </div>
          </div>
        </>
      )}

      {/* Active flash states */}
      {isActive && (
        <>
          <FlashPipeline progress={progress} />

          <p className="text-sm text-warning text-center font-mono">
            Do not disconnect your device during flash
          </p>

          <FlashConsole logs={consoleLogs} />
        </>
      )}

      {/* Flash complete — single panel: left status | center button | right device image */}
      {progress.stage === "complete" && (
        <>
          <div className="glass-card rounded-xl p-6 border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
              {/* Left: success info */}
              <div className="min-w-0 flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-teal-400 flex-shrink-0" />
                <div>
                  <h3 className="font-mono text-lg text-teal-400">
                    Flash Complete!
                  </h3>
                  <p className="text-sm text-default-400">
                    Firmware written and verified.
                  </p>
                </div>
              </div>

              {/* Center: continue button */}
              <div className="flex-shrink-0">
                <Button
                  color="primary"
                  size="lg"
                  endContent={<ArrowRight className="w-5 h-5" />}
                  onPress={onContinue}
                  className="font-mono whitespace-nowrap"
                >
                  Continue to Configure
                </Button>
              </div>

              {/* Right: device image */}
              <div className="flex flex-col items-center gap-2 justify-self-end">
                <div className="w-[140px] h-[100px] flex items-center justify-center rounded-lg bg-default-100/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getDeviceImagePath(device)}
                    alt={device.displayName}
                    className="max-h-full max-w-full object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]"
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-sm text-default-500">
                    {device.displayName}
                  </span>
                  <Chip size="sm" variant="flat" color="success">
                    {getArchLabel(device)}
                  </Chip>
                </div>
              </div>
            </div>
          </div>

          <FlashPipeline progress={progress} />

          <FlashConsole logs={consoleLogs} />
        </>
      )}

      {/* Flash error */}
      {progress.stage === "error" && (
        <>
          <FlashPipeline progress={progress} />

          {/* Recovery guidance */}
          <div className="glass-card rounded-xl p-5 border-danger/30 bg-danger/5">
            <div className="flex flex-col items-center gap-4 text-center">
              <XCircle className="w-10 h-10 text-danger" />
              <h3 className="font-mono text-lg text-danger">Flash Failed</h3>

              {progress.error && (
                <p className="text-sm text-danger/80 font-mono">
                  {progress.error}
                </p>
              )}

              <ol className="list-decimal list-inside space-y-2 text-sm text-default-400 text-left max-w-sm">
                <li>Don&apos;t panic &mdash; your device can be re-flashed</li>
                <li>Reconnect the USB cable if it was disconnected</li>
                <li>
                  Put your device in bootloader mode (hold{" "}
                  <span className="font-mono text-default-200">BOOT</span>,
                  press{" "}
                  <span className="font-mono text-default-200">RESET</span>)
                </li>
                <li>Click Retry to start over with a fresh connection</li>
              </ol>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              color="primary"
              size="lg"
              startContent={<RotateCcw className="w-5 h-5" />}
              onPress={handleRetry}
              className="font-mono"
            >
              Retry
            </Button>
          </div>

          {/* Console expanded by default on error for debugging */}
          <FlashConsole logs={consoleLogs} defaultExpanded />
        </>
      )}
    </div>
  );
}
