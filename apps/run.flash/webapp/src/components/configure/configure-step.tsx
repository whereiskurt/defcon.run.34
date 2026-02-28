"use client";

import { useEffect, useRef } from "react";
import { Button, Spinner } from "@heroui/react";
import {
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { ConfigProgress, DeviceConfigPayload } from "@/types/config";
import { ConfigPipeline } from "@/components/configure/config-pipeline";

interface UseConfigureReturn {
  progress: ConfigProgress;
  isConfiguring: boolean;
  isComplete: boolean;
  isError: boolean;
  configPayload: DeviceConfigPayload | null;
  configure: (disconnectTransport: () => Promise<void>, options?: { skipRebootDelay?: boolean }) => Promise<void>;
  reset: () => void;
}

interface ConfigureStepProps {
  /** From useConfigure hook */
  configureState: UseConfigureReturn;
  /** From serial.disconnect -- releases esptool transport */
  disconnectTransport: () => Promise<void>;
  /** advance() from useWizard */
  onContinue: () => void;
  /** Reset + goToStepForRetry("connect") */
  onRetry: () => void;
  /** Skip the 4s reboot delay (device already running, e.g. ?step=configure jump) */
  skipRebootDelay?: boolean;
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
  configureState,
  disconnectTransport,
  onContinue,
  onRetry,
  skipRebootDelay,
}: ConfigureStepProps) {
  const { progress } = configureState;
  const startedRef = useRef(false);

  // Auto-start configuration when component mounts and progress is idle
  useEffect(() => {
    if (progress.stage === "idle" && !startedRef.current) {
      startedRef.current = true;
      configureState.configure(disconnectTransport, { skipRebootDelay });
    }
  }, [progress.stage, configureState, disconnectTransport, skipRebootDelay]);

  const isConnecting = progress.stage === "connecting";
  const isConfiguring =
    progress.stage === "mqtt" ||
    progress.stage === "channels" ||
    progress.stage === "identity" ||
    progress.stage === "radio" ||
    progress.stage === "committing";

  return (
    <div className="space-y-4">
      {/* Connecting state: device is rebooting after flash */}
      {isConnecting && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex flex-col items-center gap-4 text-center">
            <Spinner size="lg" color="primary" />
            <div>
              <h3 className="font-mono text-lg text-foreground">
                Reconnecting to device...
              </h3>
              <p className="text-sm text-default-400 mt-1">
                Your device is rebooting after firmware flash. This may take a
                few seconds.
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
            Do not disconnect your device during configuration
          </p>
        </>
      )}

      {/* Config complete: pipeline (all checkmarks) + success card + continue */}
      {progress.stage === "complete" && (
        <>
          <ConfigPipeline progress={progress} />

          {/* Success message */}
          <div className="glass-card rounded-xl p-5 border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-teal-400" />
              <h3 className="font-mono text-lg text-teal-400">
                Configuration Complete!
              </h3>
              <p className="text-sm text-default-400">
                Your device has been configured for the DEF CON 34 mesh network.
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              color="primary"
              size="lg"
              endContent={<ArrowRight className="w-5 h-5" />}
              onPress={onContinue}
              className="font-mono"
            >
              Continue
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
                Configuration Failed
              </h3>

              {progress.error && (
                <p className="text-sm text-danger/80 font-mono">
                  {progress.error}
                </p>
              )}

              <ol className="list-decimal list-inside space-y-2 text-sm text-default-400 text-left max-w-sm">
                <li>Don&apos;t panic &mdash; your firmware is still intact</li>
                <li>Make sure your USB cable is still connected</li>
                <li>
                  Click Retry to reconnect and try configuration again
                </li>
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
              Retry
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
