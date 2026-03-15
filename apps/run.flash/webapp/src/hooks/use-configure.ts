"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ConfigProgress, DeviceConfigPayload, ConfigStage } from "@/types/config";
import { INITIAL_CONFIG_PROGRESS } from "@/types/config";
import {
  connectMeshtasticDevice,
  pushDeviceConfig,
  requestSecurityKeys,
  disconnectMeshtasticDevice,
} from "@/lib/meshtastic";
import type { MeshDevice } from "@meshtastic/core";

const basePath = process.env.NEXT_PUBLIC_REGION_SHORT
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT}`
  : "";

export type RegistrationStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "success"; nodeId: string; updated: boolean }
  | { state: "skipped"; reason: string }
  | { state: "failed"; error: string };

interface UseConfigureReturn {
  /** Current config push progress */
  progress: ConfigProgress;
  /** Whether config push is in progress */
  isConfiguring: boolean;
  /** Whether config push completed successfully */
  isComplete: boolean;
  /** Whether config push encountered an error */
  isError: boolean;
  /** The config payload (available after successful fetch, for Done screen display) */
  configPayload: DeviceConfigPayload | null;
  /** Radio auto-registration result */
  registrationStatus: RegistrationStatus;
  /**
   * Start the configure pipeline:
   * 1. Disconnect esptool transport
   * 2. Reconnect via @meshtastic/core (with reboot delay + retry)
   * 3. Fetch config from /api/config
   * 4. Push MQTT -> Channels -> Identity -> Radio -> Commit
   *
   * @param disconnectTransport - Function to disconnect the esptool transport (from useSerial)
   */
  configure: (disconnectTransport: () => Promise<void>) => Promise<void>;
  /** Retry radio registration (only available after a failed registration) */
  retryRegistration: () => Promise<void>;
  /** Reset config state to idle (for retry) */
  reset: () => void;
}

/**
 * Hook for orchestrating the config push pipeline.
 *
 * Follows the useFlash pattern: expose progress state + action function + reset.
 * MeshDevice is stored in useRef (not useState) because it is a mutable class
 * instance with internal state -- same pattern as ESPLoader in useSerial.
 *
 * Fail-fast: any step failure fails the entire config. No partial recovery --
 * user retries from scratch.
 *
 * No artificial delays: each config pushes as fast as the device accepts.
 */
export function useConfigure(): UseConfigureReturn {
  const [progress, setProgress] = useState<ConfigProgress>(INITIAL_CONFIG_PROGRESS);
  const [configPayload, setConfigPayload] = useState<DeviceConfigPayload | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>({ state: "idle" });
  const registrationInfoRef = useRef<{ nodeId: string; privateKey: string; publicKey: string } | null>(null);
  const isConfiguringRef = useRef(false);
  const deviceRef = useRef<MeshDevice | null>(null);

  const configure = useCallback(
    async (disconnectTransport: () => Promise<void>) => {
      if (isConfiguringRef.current) return;
      isConfiguringRef.current = true;

      try {
        // Stage 1: Disconnect esptool transport to release serial port
        setProgress({
          stage: "connecting",
          completedStages: [],
          stageSummaries: {},
          error: null,
        });

        await disconnectTransport();

        // Stage 2: Reconnect via @meshtastic/core
        // connectMeshtasticDevice() handles: close stale port, reboot delay,
        // reopen for Meshtastic protocol, configure handshake with retry.
        const { device, registrationInfo } = await connectMeshtasticDevice();
        deviceRef.current = device;

        setProgress((prev) => ({
          ...prev,
          completedStages: [...prev.completedStages, "connecting"],
          stageSummaries: {
            ...prev.stageSummaries,
            connecting: "Device connected",
          },
        }));

        // Stage 3: Fetch config from /api/config
        console.log(`[configure] Fetching config from ${basePath}/api/config...`);
        const response = await fetch(`${basePath}/api/config`);
        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            err.error || `Config fetch failed (HTTP ${response.status})`
          );
        }
        const config: DeviceConfigPayload = await response.json();
        console.log("[configure] Config received:", { mqtt: config.mqtt.server, channels: config.channels.length });
        setConfigPayload(config);

        // Stage 4: Push config with progress callbacks
        console.log("[configure] Starting config push to device...");
        const stages: ConfigStage[] = [
          "radio",
          "mqtt",
          "channels",
          "identity",
          "committing",
        ];
        let currentStageIndex = 0;

        // Set first config push stage — radio first (region needed on fresh flash)
        setProgress((prev) => ({ ...prev, stage: "radio" }));

        const onStageComplete = (stage: string, summary: string) => {
          currentStageIndex++;
          setProgress((prev) => ({
            ...prev,
            stage: stages[currentStageIndex] || "complete",
            completedStages: [...prev.completedStages, stage as ConfigStage],
            stageSummaries: { ...prev.stageSummaries, [stage]: summary },
          }));
        };

        await pushDeviceConfig(device, config, onStageComplete);

        // If keys weren't captured during the initial configure handshake
        // (common on freshly flashed devices that haven't generated their
        // X25519 keypair yet), request the security config now that the
        // full config push is done and the device has generated keys.
        let { privateKey, publicKey } = registrationInfo;
        if (!privateKey && device) {
          console.log("[configure] Keys missing from initial handshake, requesting security config...");
          const keys = await requestSecurityKeys(device);
          privateKey = keys.privateKey;
          publicKey = keys.publicKey;
        }

        // Auto-register radio with run.human
        if (registrationInfo.nodeId) {
          registrationInfoRef.current = {
            nodeId: registrationInfo.nodeId,
            privateKey: privateKey || "",
            publicKey: publicKey || "",
          };
          setRegistrationStatus({ state: "pending" });
          try {
            const regResponse = await fetch(`${basePath}/api/register-radio`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nodeId: registrationInfo.nodeId,
                privateKey,
                publicKey,
              }),
            });
            const regData = await regResponse.json().catch(() => ({}));
            if (regResponse.ok) {
              setRegistrationStatus({
                state: "success",
                nodeId: registrationInfo.nodeId,
                updated: regData.updated === true,
              });
            } else {
              const reason = regData.error || `HTTP ${regResponse.status}`;
              console.warn(`[configure] Radio registration failed: ${reason}`);
              setRegistrationStatus({ state: "failed", error: reason });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Network error";
            console.warn("[configure] Radio registration failed:", message);
            setRegistrationStatus({ state: "failed", error: message });
          }
        } else {
          setRegistrationStatus({ state: "skipped", reason: "Node ID not captured from device" });
        }

        // All done
        setProgress((prev) => ({
          ...prev,
          stage: "complete",
          completedStages: [...prev.completedStages],
        }));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Configuration failed";
        setProgress((prev) => ({
          ...prev,
          stage: "error",
          error: message,
        }));
      } finally {
        // Only disconnect on error — on success, keep the connection alive
        // until component unmounts (Done step transition).
        // Disconnecting on success causes "Cannot cancel a locked stream"
        // because the transport streams are still being processed.
        if (deviceRef.current && progress.stage === "error") {
          await disconnectMeshtasticDevice(deviceRef.current).catch(() => {});
          deviceRef.current = null;
        }
        isConfiguringRef.current = false;
      }
    },
    []
  );

  const retryRegistration = useCallback(async () => {
    const info = registrationInfoRef.current;
    if (!info) return;

    setRegistrationStatus({ state: "pending" });
    try {
      const regResponse = await fetch(`${basePath}/api/register-radio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: info.nodeId,
          privateKey: info.privateKey,
          publicKey: info.publicKey,
        }),
      });
      const regData = await regResponse.json().catch(() => ({}));
      if (regResponse.ok) {
        setRegistrationStatus({
          state: "success",
          nodeId: info.nodeId,
          updated: regData.updated === true,
        });
      } else {
        const reason = regData.error || `HTTP ${regResponse.status}`;
        console.warn(`[configure] Radio registration retry failed: ${reason}`);
        setRegistrationStatus({ state: "failed", error: reason });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      console.warn("[configure] Radio registration retry failed:", message);
      setRegistrationStatus({ state: "failed", error: message });
    }
  }, []);

  const reset = useCallback(() => {
    setProgress(INITIAL_CONFIG_PROGRESS);
    setConfigPayload(null);
    setRegistrationStatus({ state: "idle" });
    isConfiguringRef.current = false;
  }, []);

  // Cleanup on unmount -- disconnect device if component unmounts mid-config
  useEffect(() => {
    return () => {
      if (deviceRef.current) {
        disconnectMeshtasticDevice(deviceRef.current).catch(() => {});
      }
    };
  }, []);

  const activeStages: ConfigStage[] = [
    "connecting",
    "mqtt",
    "channels",
    "identity",
    "radio",
    "committing",
  ];

  return {
    progress,
    isConfiguring: activeStages.includes(progress.stage),
    isComplete: progress.stage === "complete",
    isError: progress.stage === "error",
    configPayload,
    registrationStatus,
    configure,
    retryRegistration,
    reset,
  };
}
