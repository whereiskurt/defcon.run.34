"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ConfigProgress, DeviceConfigPayload, ConfigStage } from "@/types/config";
import { INITIAL_CONFIG_PROGRESS } from "@/types/config";
import {
  connectMeshtasticDevice,
  connectMeshtasticDeviceNrf52,
  pushDeviceConfig,
  requestSecurityKeys,
  disconnectMeshtasticDevice,
} from "@/lib/meshtastic";
import type { MeshDevice } from "@meshtastic/core";
import type { DeviceFamily } from "@/types/device";

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

export type RegistrationStatus =
  | { state: "idle" }
  | { state: "pending" }
  /**
   * `updated` = re-flash of a radio already on this account.
   * `transferred` = the radio was registered to ANOTHER account and ownership
   * moved here (same physical radio keeps its "!id" across re-flashes, so event
   * loaners land in this case). Mutually exclusive with `updated`.
   */
  | { state: "success"; nodeId: string; updated: boolean; transferred: boolean }
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
  /** True while the native-USB reconnect needs the user to power-cycle the
   *  device (no firmware output heard yet). Drives the power-cycle prompt. */
  awaitingUserReset: boolean;
  /**
   * Start the configure pipeline:
   * 1. Disconnect esptool transport
   * 2. Reconnect via @meshtastic/core (with reboot delay + retry)
   * 3. Fetch config from /api/config
   * 4. Push MQTT -> Channels -> Identity -> Radio -> Commit
   *
   * @param disconnectTransport - Function to disconnect the esptool transport (from useSerial)
   * @param family - Device family; selects the reconnect strategy. "esp32"
   *   reuses the connect-step serial grant + resets out of ROM bootloader;
   *   "nrf52" prompts for the freshly-enumerated CDC port (UF2 flash grants no
   *   serial permission). Defaults to "esp32" for the pre-existing call shape.
   * @param opts.nativeUsb - Native-USB ESP32 (S3/C3/C6): use the adaptive
   *   poll + power-cycle-prompt reconnect instead of the blind DTR/RTS dance.
   */
  configure: (
    disconnectTransport: () => Promise<void>,
    family?: DeviceFamily,
    opts?: { nativeUsb?: boolean }
  ) => Promise<void>;
  /** Retry radio registration (only available after a failed registration) */
  retryRegistration: () => Promise<void>;
  /**
   * Sync keys for an already-flashed / re-keyed device.
   *
   * One-shot: connect over Web Serial, read back the device's real on-device
   * X25519 keypair from SECURITY_CONFIG (+ nodeId from myNodeInfo), and POST it
   * to /api/register-radio — nothing else. NO config push, NO flash, NO region
   * write (spec §4.3 "no full re-provision"). Handles the reflash-regenerates-keys
   * case: after a reflash the user runs Sync keys and DDB gets the new device
   * pubkey within one keycache TTL. Disconnects the device when done.
   *
   * @param family - Device family; selects the connect strategy, mirroring
   *   configure(). Defaults to "esp32".
   */
  syncKeys: (family?: DeviceFamily) => Promise<void>;
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
  const [awaitingUserReset, setAwaitingUserReset] = useState(false);
  const registrationInfoRef = useRef<{ nodeId: string; privateKey: string; publicKey: string } | null>(null);
  const isConfiguringRef = useRef(false);
  const deviceRef = useRef<MeshDevice | null>(null);

  const configure = useCallback(
    async (
      disconnectTransport: () => Promise<void>,
      family: DeviceFamily = "esp32",
      opts?: { nativeUsb?: boolean }
    ) => {
      if (isConfiguringRef.current) return;
      isConfiguringRef.current = true;

      try {
        // Stage 1: Disconnect esptool transport to release serial port.
        // For nRF52 this is a no-op (no esptool transport was ever opened —
        // the device was flashed via UF2 drag-drop), but we still await the
        // passed function so the caller controls any cleanup.
        setProgress({
          stage: "connecting",
          completedStages: [],
          stageSummaries: {},
          error: null,
        });

        await disconnectTransport();

        // Stage 2: Reconnect via @meshtastic/core.
        // ESP32: reuse the connect-step serial grant, reset out of ROM
        //   bootloader, drain boot text, then handshake.
        // nRF52: prompt for the freshly-enumerated CDC port (the UF2 flash
        //   granted no serial permission), then handshake — no reset/drain.
        const { device, registrationInfo } =
          family === "nrf52"
            ? await connectMeshtasticDeviceNrf52()
            : await connectMeshtasticDevice({
                nativeUsb: opts?.nativeUsb,
                onAwaitingUserReset: setAwaitingUserReset,
              });
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
          "identity",
          "radio",
          "mqtt",
          "channels",
          "ringtone",
          "committing",
        ];
        let currentStageIndex = 0;

        // Set first config push stage — identity first (un-licenses HAM-default
        // boards BEFORE the region write triggers the licensed node-number
        // migration; see pushDeviceConfig)
        setProgress((prev) => ({ ...prev, stage: "identity" }));

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
                transferred: regData.transferred === true,
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
        setAwaitingUserReset(false);
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
          transferred: regData.transferred === true,
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

  const syncKeys = useCallback(
    async (family: DeviceFamily = "esp32") => {
      if (isConfiguringRef.current) return;
      isConfiguringRef.current = true;

      setRegistrationStatus({ state: "pending" });

      let device: MeshDevice | null = null;
      try {
        // Connect via the same read-back path the wizard uses. This performs a
        // config-dump handshake that populates myNodeInfo (nodeId) and captures
        // the device's SECURITY_CONFIG keys — a FRESH read-back, not cached
        // registration info. NO config push / flash / region write happens here.
        const { device: connected, registrationInfo } =
          family === "nrf52"
            ? await connectMeshtasticDeviceNrf52()
            : await connectMeshtasticDevice();
        device = connected;
        deviceRef.current = device;

        // Belt-and-suspenders: if the handshake didn't surface the keys (device
        // may not have re-emitted SECURITY_CONFIG), request them explicitly —
        // same fallback as configure().
        let { privateKey, publicKey } = registrationInfo;
        if (!privateKey && device) {
          console.log("[syncKeys] Keys missing from handshake, requesting security config...");
          const keys = await requestSecurityKeys(device);
          privateKey = keys.privateKey;
          publicKey = keys.publicKey;
        }

        if (!registrationInfo.nodeId) {
          setRegistrationStatus({ state: "skipped", reason: "Node ID not captured from device" });
          return;
        }

        // Cache for retryRegistration and POST to the same register-radio route
        // (identical body to configure/retryRegistration). The route's existing
        // session + assertNotLockedLive gate covers this write for free.
        registrationInfoRef.current = {
          nodeId: registrationInfo.nodeId,
          privateKey: privateKey || "",
          publicKey: publicKey || "",
        };

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
            transferred: regData.transferred === true,
          });
        } else {
          const reason = regData.error || `HTTP ${regResponse.status}`;
          console.warn(`[syncKeys] Radio registration failed: ${reason}`);
          setRegistrationStatus({ state: "failed", error: reason });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync keys failed";
        console.warn("[syncKeys] Failed:", message);
        setRegistrationStatus({ state: "failed", error: message });
      } finally {
        // Standalone one-shot: always disconnect (unlike configure(), which keeps
        // the connection alive for the Done transition).
        if (device) {
          await disconnectMeshtasticDevice(device).catch(() => {});
        }
        deviceRef.current = null;
        isConfiguringRef.current = false;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setProgress(INITIAL_CONFIG_PROGRESS);
    setConfigPayload(null);
    setRegistrationStatus({ state: "idle" });
    setAwaitingUserReset(false);
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
    "identity",
    "radio",
    "mqtt",
    "channels",
    "committing",
  ];

  return {
    progress,
    isConfiguring: activeStages.includes(progress.stage),
    isComplete: progress.stage === "complete",
    isError: progress.stage === "error",
    configPayload,
    registrationStatus,
    awaitingUserReset,
    configure,
    retryRegistration,
    syncKeys,
    reset,
  };
}
