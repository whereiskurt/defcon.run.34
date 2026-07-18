"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button, Chip, Spinner } from "@heroui/react";
import {
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Usb,
} from "lucide-react";
import type { ConfigProgress, DeviceConfigPayload } from "@/types/config";
import type { DeviceHardware, DeviceFamily } from "@/types/device";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";
import { ConfigPipeline } from "@/components/configure/config-pipeline";
import { useCopy } from "@/components/CopyProvider";

const ARCH_COLORS: Record<string, "primary" | "secondary" | "warning" | "success"> = {
  esp32: "primary",
  "esp32-s3": "secondary",
  "esp32-c3": "warning",
  "esp32-c6": "success",
};

interface UseConfigureReturn {
  progress: ConfigProgress;
  isConfiguring: boolean;
  isComplete: boolean;
  isError: boolean;
  configPayload: DeviceConfigPayload | null;
  configure: (
    disconnectTransport: () => Promise<void>,
    family?: DeviceFamily
  ) => Promise<void>;
  reset: () => void;
}

interface ConfigureStepProps {
  /** Selected device for image display */
  device: DeviceHardware | null;
  /** Device family — selects the reconnect strategy in useConfigure. */
  family: DeviceFamily;
  /** From useConfigure hook */
  configureState: UseConfigureReturn;
  /** From serial.disconnect (esp32) or a no-op (nrf52) */
  disconnectTransport: () => Promise<void>;
  /**
   * Whether to auto-start configuration on mount. ESP32 reuses the serial
   * grant from the Connect step (no user gesture needed), so it auto-starts.
   * nRF52 must call navigator.serial.requestPort(), which requires a user
   * gesture — so it renders a Connect button instead of auto-starting.
   */
  autoStart: boolean;
  /** advance() from useWizard */
  onContinue: () => void;
  /** Reset + goToStepForRetry(...) */
  onRetry: () => void;
}

/**
 * Configure wizard step: auto-starts config push on mount, shows
 * four-stage pipeline progress, success/error states with retry flow.
 *
 * Per CONTEXT.md locked decisions:
 * - Auto-start config when step becomes active (no manual trigger)
 * - Real-time speed, no artificial delays
 * - Fail entire config on any step failure
 * - Retry returns to Connect step (fresh serial connection)
 */
export function ConfigureStep({
  device,
  family,
  configureState,
  disconnectTransport,
  autoStart,
  onContinue,
  onRetry,
}: ConfigureStepProps) {
  const { t } = useCopy();
  const { progress } = configureState;
  const startedRef = useRef(false);

  const archColor = device ? (ARCH_COLORS[device.architecture] || "primary") : "primary";

  const startConfigure = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    configureState.configure(disconnectTransport, family);
  }, [configureState, disconnectTransport, family]);

  // ESP32 auto-starts on mount (serial grant already exists, no gesture
  // needed). nRF52 waits for the Connect button click below (requestPort
  // needs a user gesture).
  useEffect(() => {
    if (autoStart && progress.stage === "idle" && !startedRef.current) {
      startConfigure();
    }
  }, [autoStart, progress.stage, startConfigure]);

  // nRF52 idle: prompt the user to connect (a gesture-driven requestPort()).
  const showConnectPrompt = !autoStart && progress.stage === "idle";

  const isConnecting = progress.stage === "connecting";
  const isConfiguring =
    progress.stage === "mqtt" ||
    progress.stage === "channels" ||
    progress.stage === "identity" ||
    progress.stage === "ringtone" ||
    progress.stage === "radio" ||
    progress.stage === "committing";

  return (
    <div className="space-y-4">
      {/* nRF52 idle: explicit connect (requestPort needs a user gesture) */}
      {showConnectPrompt && (
        <div className="glass-card rounded-xl p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <h3 className="font-mono text-lg text-foreground">
              {t("flash.configure.connectTitle")}
            </h3>
            <p className="text-sm text-default-400 max-w-md">
              {t("flash.configure.connectBody")}
            </p>
            <Button
              color="primary"
              size="lg"
              startContent={<Usb className="w-5 h-5" />}
              onPress={startConfigure}
              className="font-mono whitespace-nowrap cta-pulse"
            >
              {t("flash.configure.connectButton")}
            </Button>
          </div>
        </div>
      )}

      {/* Connecting state: device is rebooting after flash */}
      {isConnecting && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex flex-col items-center gap-4 text-center">
            <Spinner size="lg" classNames={{ circle1: "border-b-teal-400", circle2: "border-b-teal-400" }} />
            <div>
              <h3 className="font-mono text-lg text-foreground">
                {family === "nrf52"
                  ? t("flash.configure.selectPortTitle")
                  : t("flash.configure.reconnectingTitle")}
              </h3>
              <p className="text-sm text-default-400 mt-1">
                {family === "nrf52"
                  ? t("flash.configure.selectPortBody")
                  : t("flash.configure.reconnectingBody")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active config push: pipeline + warning */}
      {isConfiguring && (
        <>
          <ConfigPipeline progress={progress} />

          <p className="text-sm text-warning text-center font-mono">
            {t("flash.configure.doNotDisconnect")}
          </p>
        </>
      )}

      {/* Config complete: pipeline (all checkmarks) + success panel with device image + continue */}
      {progress.stage === "complete" && (
        <>
          <ConfigPipeline progress={progress} />

          {/* Success panel: left status | center spacer | right device image */}
          <div className="glass-card rounded-xl p-6 border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
              {/* Left: success info */}
              <div className="min-w-0 flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-primary flex-shrink-0" />
                <div>
                  <h3 className="font-mono text-lg text-primary">
                    {t("flash.configure.complete")}
                  </h3>
                  <p className="text-sm text-default-400">
                    {t("flash.configure.completeBody")}
                  </p>
                </div>
              </div>

              {/* Center: spacer */}
              <div className="flex-shrink-0" />

              {/* Right: device image */}
              {device ? (
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
                    <Chip size="sm" variant="flat" color={archColor}>
                      {getArchLabel(device)}
                    </Chip>
                  </div>
                </div>
              ) : (
                <div />
              )}
            </div>
          </div>

          {/* CTA button below panel */}
          <div className="flex justify-center">
            <Button
              color="primary"
              size="lg"
              endContent={<ArrowRight className="w-5 h-5" />}
              onPress={onContinue}
              className="font-mono cta-pulse"
            >
              {t("flash.configure.continue")}
            </Button>
          </div>
        </>
      )}

      {/* Config error: pipeline + error card + retry */}
      {progress.stage === "error" && (
        <>
          <ConfigPipeline progress={progress} />

          {/* Recovery guidance */}
          <div className="glass-card rounded-xl p-5 border-danger/30 bg-danger/5">
            <div className="flex flex-col items-center gap-4 text-center">
              <XCircle className="w-10 h-10 text-danger" />
              <h3 className="font-mono text-lg text-danger">
                {t("flash.configure.failed")}
              </h3>

              {progress.error && (
                <p className="text-sm text-danger/80 font-mono">
                  {progress.error}
                </p>
              )}

              <ol className="list-decimal list-inside space-y-2 text-sm text-default-400 text-left max-w-sm">
                <li>{t("flash.configure.recovery1")}</li>
                <li>{t("flash.configure.recovery2")}</li>
                <li>{t("flash.configure.recovery3")}</li>
              </ol>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              color="primary"
              size="lg"
              startContent={<RotateCcw className="w-5 h-5" />}
              onPress={onRetry}
              className="font-mono"
            >
              {t("flash.configure.retry")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
