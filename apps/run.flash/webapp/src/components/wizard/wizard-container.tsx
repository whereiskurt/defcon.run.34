"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWizard, STEPS, type WizardStep } from "@/hooks/use-wizard";
import { useSerial } from "@/hooks/use-serial";
import { useDfu } from "@/hooks/use-dfu";
import { useFlash } from "@/hooks/use-flash";
import { useConfigure } from "@/hooks/use-configure";
import { validateChipMatch } from "@/lib/esptool";
import {
  DEFAULT_FIRMWARE_VERSION,
  lockedVersionForDevice,
} from "@/config/firmware";
import { getDeviceFamily, type DeviceHardware } from "@/types/device";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import { DeviceGrid } from "@/components/device-picker/device-grid";
import { DownloadConfigMenu } from "@/components/download-config-menu";
import { ConnectStep, type TransportState } from "@/components/connect/connect-step";
import { FlashStep, type FlashTransport } from "@/components/flash/flash-step";
import { Nrf52FlashStep } from "@/components/flash/nrf52-flash-step";
import { ConfigureStep } from "@/components/configure/configure-step";
import { DoneStep } from "@/components/done/done-step";
import { AppDownloadsCard } from "@/components/app-downloads-card";

/** No-op transport disconnect for the nRF52 configure path — the device was
 *  flashed via UF2 drag-drop, so there is no esptool serial transport to
 *  release before the Meshtastic serial handshake. */
const noopDisconnect = async () => {};

export function WizardContainer() {
  const {
    currentStep,
    completedSteps,
    selectedDevice,
    canAdvance,
    advance,
    goToStep,
    goToStepForRetry,
    selectDevice,
  } = useWizard();

  const serial = useSerial();
  // Both transport hooks are spawned unconditionally so we obey React
  // rules-of-hooks (mirrors the `useFlash` router which also calls both
  // delegate hooks every render). The wizard picks which transport to
  // consume by device family (Task 25-01-02 wires the ConnectStep prop).
  const dfu = useDfu();
  const flashState = useFlash();
  const configureState = useConfigure();

  // Selected firmware version — sticky across "Flash Another Device" so a
  // booth operator's choice survives multi-board provisioning runs.
  const [firmwareVersion, setFirmwareVersion] = useState(
    DEFAULT_FIRMWARE_VERSION
  );

  // Device selection applies slot locks: a board whose target only exists in
  // one firmware slot (T-Beam BPF → the 2.8 nightly pin) forces that version;
  // picking any other board resets to the default so a lock never leaks into
  // the next device's flash.
  const handleSelectDevice = useCallback(
    (device: DeviceHardware) => {
      setFirmwareVersion(
        lockedVersionForDevice(device.platformioTarget) ??
          DEFAULT_FIRMWARE_VERSION
      );
      selectDevice(device);
    },
    [selectDevice]
  );

  // Derive the device family once here (CONTEXT Decision 2 — never re-derived
  // in leaf components). Null before a device is picked; getDeviceFamily
  // throws fail-fast on unknown architectures so an unsupported device never
  // reaches the connect step silently.
  const family = selectedDevice ? getDeviceFamily(selectedDevice) : null;

  // nRF52 has no Web-Serial "Connect" step (flashed via UF2 drag-drop, connects
  // over serial only during Configure), so hide it from the stepper.
  const visibleSteps: WizardStep[] =
    family === "nrf52" ? STEPS.filter((s) => s !== "connect") : STEPS;

  // Build the discriminated transport for ConnectStep. nRF52 devices route
  // through the DFU handle; ESP32 devices keep the serial handle. Default
  // to esp32 before a device is selected so ConnectStep always receives a
  // typed transport (the step only renders once a device is chosen anyway).
  const transport: TransportState =
    family === "nrf52"
      ? { family: "nrf52", dfu }
      : { family: "esp32", serial };

  // Parallel discriminated transport-ref for FlashStep — same family switch,
  // but exposing the underlying ESPLoader / DfuDevice ref that the router
  // (useFlash) needs to hand off to the family-specific flash pipeline.
  const flashTransport: FlashTransport =
    family === "nrf52"
      ? { family: "nrf52", dfuDeviceRef: dfu.dfuDeviceRef }
      : { family: "esp32", espLoaderRef: serial.espLoaderRef };

  // Compute chip mismatch: detected chip must match selected device architecture.
  // Only meaningful for ESP32 — nRF52 has no esptool-style chip identifier.
  const chipMismatch =
    serial.chipInfo && selectedDevice
      ? !validateChipMatch(serial.chipInfo.chipName, selectedDevice.architecture)
      : false;

  // Reset entire wizard for "Flash Another Device" flow.
  // Both transports are reset regardless of which family the previous flash
  // used, so a subsequent nRF52 flow doesn't inherit a stale ESP32 handle
  // (and vice versa). Both disconnect calls are fire-and-forget — the useDfu
  // / useSerial hooks each swallow already-disconnected errors.
  const resetWizard = useCallback(() => {
    flashState.reset();
    configureState.reset();
    serial.disconnect();
    dfu.disconnect();
    goToStepForRetry("pick-device");
  }, [flashState, configureState, serial, dfu, goToStepForRetry]);

  return (
    <div className="flex flex-col gap-4">
      {/* Stepper bar */}
      <div className="glass-card rounded-xl">
        <WizardStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={goToStep}
          steps={visibleSteps}
        />
      </div>

      {/* Step content with animations */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          {currentStep === "pick-device" && (
            <div className="space-y-4">
              <DeviceGrid
                onSelect={handleSelectDevice}
                selectedDevice={selectedDevice}
                onContinue={canAdvance("pick-device") ? advance : undefined}
              />
              <AppDownloadsCard variant="compact" />
              <DownloadConfigMenu payload={null} variant="card" />
            </div>
          )}

          {/* Connect is ESP32-only. nRF52 skips it (see visibleSteps / the
              pre-completed "connect" step in useWizard.selectDevice). */}
          {currentStep === "connect" && family !== "nrf52" && (
            <ConnectStep
              device={selectedDevice}
              transport={transport}
              chipMismatch={chipMismatch}
              skipFlash={completedSteps.has("flash")}
              onContinue={advance}
            />
          )}

          {currentStep === "flash" && selectedDevice && (
            // - nRF52: guided UF2 drag-drop (no live transport — the Adafruit
            //   bootloader exposes a mass-storage volume, not DFU/serial).
            // - ESP32: esptool pipeline, gated on `serial.chipInfo`.
            family === "nrf52" ? (
              <Nrf52FlashStep
                device={selectedDevice}
                firmwareVersion={firmwareVersion}
                onFirmwareVersionChange={setFirmwareVersion}
                onContinue={advance}
              />
            ) : (
              serial.chipInfo && (
                <FlashStep
                  device={selectedDevice}
                  chipInfo={serial.chipInfo}
                  flashState={flashState}
                  firmwareVersion={firmwareVersion}
                  onFirmwareVersionChange={setFirmwareVersion}
                  transport={flashTransport}
                  consoleLogs={serial.consoleLogs}
                  appendLog={serial.appendLog}
                  onContinue={advance}
                  onRetry={() => {
                    flashState.reset();
                    serial.disconnect();
                    goToStepForRetry("connect");
                  }}
                />
              )
            )
          )}

          {currentStep === "configure" && (
            <ConfigureStep
              device={selectedDevice}
              family={family ?? "esp32"}
              configureState={configureState}
              disconnectTransport={
                family === "nrf52" ? noopDisconnect : serial.disconnect
              }
              autoStart={family !== "nrf52"}
              onContinue={advance}
              onRetry={() => {
                configureState.reset();
                flashState.reset();
                // nRF52 retries from the guided-flash step (no Connect step);
                // ESP32 retries from Connect with a fresh serial session.
                if (family === "nrf52") {
                  goToStepForRetry("flash");
                } else {
                  serial.disconnect();
                  goToStepForRetry("connect");
                }
              }}
            />
          )}

          {currentStep === "done" && (
            <DoneStep
              device={selectedDevice}
              firmwareVersion={firmwareVersion}
              configPayload={configureState.configPayload}
              registrationStatus={configureState.registrationStatus}
              onRetryRegistration={configureState.retryRegistration}
              onSyncKeys={configureState.syncKeys}
              onFlashAnother={resetWizard}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
