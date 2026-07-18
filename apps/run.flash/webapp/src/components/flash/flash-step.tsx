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
import type { DfuDevice } from "@/lib/web-dfu";
import { useCopy } from "@/components/CopyProvider";

/**
 * Discriminated transport union — parallels ConnectStep's TransportState.
 * ESP32 flashes take an ESPLoader ref; nRF52 flashes take a DfuDevice ref.
 * `handleFlash` picks the correct ref by family; the router downstream
 * (useFlash) already accepts the union type.
 *
 * Per CONTEXT Decision 1 (Phase 24): discriminated union, NOT two
 * mutually-exclusive optional props — the compiler fails fast on family
 * mismatch (an ESP32 call site can't accidentally pass a DFU ref).
 */
export type FlashTransport =
  | { family: "esp32"; espLoaderRef: React.RefObject<ESPLoader | null> }
  | { family: "nrf52"; dfuDeviceRef: React.RefObject<DfuDevice | null> };

interface FlashStepProps {
  device: DeviceHardware;
  /** ESP32 chip info from esptool. Absent on the nRF52 path — DFU class
   *  doesn't expose an esptool-style chip identifier, so the pre-flash
   *  panel falls through to a VID/PID line instead. */
  chipInfo?: ChipInfo;
  flashState: {
    progress: FlashProgress;
    isFlashing: boolean;
    isComplete: boolean;
    isError: boolean;
    /** Router shape from useFlash — accepts either transport. */
    flash: (
      transport: ESPLoader | DfuDevice,
      device: DeviceHardware,
      appendLog: (text: string) => void
    ) => Promise<void>;
    reset: () => void;
  };
  transport: FlashTransport;
  consoleLogs: ConsoleEntry[];
  appendLog: (text: string) => void;
  onContinue: () => void;
  onRetry: () => void;
}

/**
 * Format a USB vendor/product ID pair as a canonical `VID:PID` hex string.
 * Mirrors the formatter in connect-step.tsx (Nrf52ConnectView).
 */
function formatVidPid(vendorId: number, productId: number): string {
  const vid = vendorId.toString(16).padStart(4, "0");
  const pid = productId.toString(16).padStart(4, "0");
  return `${vid}:${pid}`;
}

/**
 * Flash wizard step: pre-flash confirmation, staged pipeline visualization,
 * expandable console, success/failure states with retry flow.
 *
 * Per CONTEXT.md locked decisions:
 * - Manual flash start (no auto-start, no countdown)
 * - Clear erase warning before flash button
 * - Pre-flash info panel with device, chip/VID:PID, firmware details
 * - Recovery guidance with retry back to Connect step
 * - Flash success: all green checkmarks + "Continue to Configure"
 *
 * Per Phase 25 (Plan 25-02-03):
 * - `transport` is a discriminated union — `handleFlash` picks the right
 *   ref by family and passes it to `flashState.flash` (which is already
 *   the router shape from useFlash).
 * - Pre-flash panel: ESP32 shows the "Chip: …" line from esptool;
 *   nRF52 shows "USB: VID:PID" from the DfuDevice.
 */
export function FlashStep({
  device,
  chipInfo,
  flashState,
  transport,
  consoleLogs,
  appendLog,
  onContinue,
  onRetry,
}: FlashStepProps) {
  const { t } = useCopy();
  const { progress } = flashState;
  const isActive =
    progress.stage === "erasing" ||
    progress.stage === "writing" ||
    progress.stage === "verifying";

  const handleFlash = () => {
    if (transport.family === "esp32") {
      const loader = transport.espLoaderRef.current;
      if (!loader) return;
      flashState.flash(loader, device, appendLog);
    } else {
      const dfuDevice = transport.dfuDeviceRef.current;
      if (!dfuDevice) return;
      flashState.flash(dfuDevice, device, appendLog);
    }
  };

  const handleRetry = () => {
    flashState.reset();
    onRetry();
  };

  const transportReady =
    transport.family === "esp32"
      ? !!transport.espLoaderRef.current
      : !!transport.dfuDeviceRef.current;

  // Family-aware pre-flash identity line (ESP32: chip name; nRF52: VID:PID).
  const identityLabel = transport.family === "esp32" ? "Chip" : "USB";
  const identityValue =
    transport.family === "esp32"
      ? chipInfo?.chipName ?? "—"
      : transport.dfuDeviceRef.current
        ? formatVidPid(
            transport.dfuDeviceRef.current.vendorId,
            transport.dfuDeviceRef.current.productId
          )
        : "—";

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
                  {t("flash.flash.eraseWarning")}
                </p>
                <p className="text-xs text-default-500">
                  {t("flash.flash.keepConnected")}
                </p>
              </div>
            </div>
            <Button
              color="danger"
              size="lg"
              startContent={<Zap className="w-5 h-5" />}
              onPress={handleFlash}
              isDisabled={!transportReady}
              className="font-mono whitespace-nowrap"
            >
              {t("flash.flash.button")}
            </Button>
          </div>

          {/* Device details panel */}
          <div className="glass-card rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">{t("flash.flash.deviceLabel")}</span>
              <span className="font-mono text-foreground">
                {device.displayName}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">{identityLabel}</span>
              <span className="font-mono text-foreground">
                {identityValue}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-start justify-between text-sm">
              <span className="text-default-500">{t("flash.flash.firmwareLabel")}</span>
              <div className="flex flex-col items-end text-right">
                <span className="font-mono text-foreground">
                  {t("flash.flash.firmwareName")}
                </span>
                <span className="font-mono text-default-500 text-xs">
                  Meshtastic {FIRMWARE_VERSION}
                </span>
              </div>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">{t("flash.flash.fileLabel")}</span>
              <span className="font-mono text-foreground text-xs">
                {getFactoryFilename(device)}
              </span>
            </div>
            <div className="border-t border-default-200/10" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-default-500">{t("flash.flash.addressLabel")}</span>
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

          <FlashConsole logs={consoleLogs} />

          <p className="text-sm text-warning text-center font-mono">
            {t("flash.flash.doNotDisconnect")}
          </p>
        </>
      )}

      {/* Flash complete — panel: left status | center spacer | right device image; button below */}
      {progress.stage === "complete" && (
        <>
          <div className="glass-card rounded-xl p-6 border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
              {/* Left: success info */}
              <div className="min-w-0 flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-primary flex-shrink-0" />
                <div>
                  <h3 className="font-mono text-lg text-primary">
                    {t("flash.flash.complete")}
                  </h3>
                  <p className="text-sm text-default-400">
                    {t("flash.flash.completeBody")}
                  </p>
                </div>
              </div>

              {/* Center: spacer */}
              <div className="flex-shrink-0" />

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

          {/* CTA button below pipeline + console */}
          <div className="flex justify-center">
            <Button
              color="primary"
              size="lg"
              endContent={<ArrowRight className="w-5 h-5" />}
              onPress={onContinue}
              className="font-mono whitespace-nowrap cta-pulse"
            >
              {t("flash.flash.continueToConfigure")}
            </Button>
          </div>
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
              <h3 className="font-mono text-lg text-danger">{t("flash.flash.failed")}</h3>

              {progress.error && (
                <p className="text-sm text-danger/80 font-mono">
                  {progress.error}
                </p>
              )}

              <ol className="list-decimal list-inside space-y-2 text-sm text-default-400 text-left max-w-sm">
                <li>{t("flash.flash.recovery1")}</li>
                <li>{t("flash.flash.recovery2")}</li>
                {transport.family === "esp32" ? (
                  <li>
                    Put your device in bootloader mode (hold{" "}
                    <span className="font-mono text-foreground">BOOT</span>,
                    press{" "}
                    <span className="font-mono text-foreground">RESET</span>)
                  </li>
                ) : (
                  <li>
                    Put your device in bootloader mode (
                    <span className="font-mono text-foreground">
                      double-tap RESET
                    </span>
                    ) &mdash; confirm the Adafruit UF2 mass-storage volume
                    appears before retrying
                  </li>
                )}
                <li>{t("flash.flash.recovery4")}</li>
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
              {t("flash.flash.retry")}
            </Button>
          </div>

          {/* Console expanded by default on error for debugging */}
          <FlashConsole logs={consoleLogs} defaultExpanded />
        </>
      )}
    </div>
  );
}
