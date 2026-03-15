"use client";

import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWizard } from "@/hooks/use-wizard";
import { useSerial } from "@/hooks/use-serial";
import { useFlash } from "@/hooks/use-flash";
import { useConfigure } from "@/hooks/use-configure";
import { validateChipMatch } from "@/lib/esptool";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import { DeviceGrid } from "@/components/device-picker/device-grid";
import { ConnectStep } from "@/components/connect/connect-step";
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
  const flashState = useFlash();
  const configureState = useConfigure();

  // Compute chip mismatch: detected chip must match selected device architecture
  const chipMismatch =
    serial.chipInfo && selectedDevice
      ? !validateChipMatch(serial.chipInfo.chipName, selectedDevice.architecture)
      : false;

  // Reset entire wizard for "Flash Another Device" flow
  const resetWizard = useCallback(() => {
    flashState.reset();
    configureState.reset();
    serial.disconnect();
    goToStepForRetry("pick-device");
  }, [flashState, configureState, serial, goToStepForRetry]);

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
              serial={serial}
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
              onFlashAnother={resetWizard}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
