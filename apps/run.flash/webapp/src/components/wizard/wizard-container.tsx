"use client";

import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWizard } from "@/hooks/use-wizard";
import { useSerial } from "@/hooks/use-serial";
import { useDfu } from "@/hooks/use-dfu";
import { useFlash } from "@/hooks/use-flash";
import { useConfigure } from "@/hooks/use-configure";
import { validateChipMatch } from "@/lib/esptool";
import { getDeviceFamily } from "@/types/device";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import { DeviceGrid } from "@/components/device-picker/device-grid";
import { ConnectStep, type TransportState } from "@/components/connect/connect-step";
import { FlashStep } from "@/components/flash/flash-step";
import { ConfigureStep } from "@/components/configure/configure-step";
import { DoneStep } from "@/components/done/done-step";

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

  // Derive the device family once here (CONTEXT Decision 2 — never re-derived
  // in leaf components). Null before a device is picked; getDeviceFamily
  // throws fail-fast on unknown architectures so an unsupported device never
  // reaches the connect step silently.
  const family = selectedDevice ? getDeviceFamily(selectedDevice) : null;

  // Build the discriminated transport for ConnectStep. nRF52 devices route
  // through the DFU handle; ESP32 devices keep the serial handle. Default
  // to esp32 before a device is selected so ConnectStep always receives a
  // typed transport (the step only renders once a device is chosen anyway).
  const transport: TransportState =
    family === "nrf52"
      ? { family: "nrf52", dfu }
      : { family: "esp32", serial };

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
            <DeviceGrid
              onSelect={selectDevice}
              selectedDevice={selectedDevice}
              onContinue={canAdvance("pick-device") ? advance : undefined}
            />
          )}

          {currentStep === "connect" && (
            <ConnectStep
              device={selectedDevice}
              transport={transport}
              chipMismatch={chipMismatch}
              skipFlash={completedSteps.has("flash")}
              onContinue={advance}
            />
          )}

          {currentStep === "flash" && selectedDevice && serial.chipInfo && (
            <FlashStep
              device={selectedDevice}
              chipInfo={serial.chipInfo}
              flashState={flashState}
              espLoaderRef={serial.espLoaderRef}
              consoleLogs={serial.consoleLogs}
              appendLog={serial.appendLog}
              onContinue={advance}
              onRetry={() => {
                flashState.reset();
                serial.disconnect();
                goToStepForRetry("connect");
              }}
            />
          )}

          {currentStep === "configure" && (
            <ConfigureStep
              device={selectedDevice}
              configureState={configureState}
              disconnectTransport={serial.disconnect}
              onContinue={advance}

              onRetry={() => {
                configureState.reset();
                flashState.reset();
                serial.disconnect();
                goToStepForRetry("connect");
              }}
            />
          )}

          {currentStep === "done" && (
            <DoneStep
              device={selectedDevice}
              configPayload={configureState.configPayload}
              registrationStatus={configureState.registrationStatus}
              onRetryRegistration={configureState.retryRegistration}
              onFlashAnother={resetWizard}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
