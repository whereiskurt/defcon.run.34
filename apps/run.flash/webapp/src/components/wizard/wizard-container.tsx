"use client";

import { Button, Card, CardBody } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { Usb, Cpu, Settings, PartyPopper } from "lucide-react";
import { useWizard } from "@/hooks/use-wizard";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import { DeviceGrid } from "@/components/device-picker/device-grid";

function PlaceholderStep({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <Card className="glass-card">
      <CardBody className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-content2 flex items-center justify-center">
          <Icon className="w-8 h-8 text-default-400" />
        </div>
        <h2 className="text-xl font-mono text-default-300">{title}</h2>
        <p className="text-default-500 text-sm max-w-md">{description}</p>
        <span className="text-xs font-mono text-default-400 mt-2">
          Coming in {phase}
        </span>
      </CardBody>
    </Card>
  );
}

export function WizardContainer() {
  const {
    currentStep,
    completedSteps,
    selectedDevice,
    canAdvance,
    advance,
    goToStep,
    selectDevice,
  } = useWizard();

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
            <PlaceholderStep
              icon={Usb}
              title="Connect your device via USB"
              description="Plug in your Meshtastic device and establish a serial connection through your browser."
              phase="Phase 2"
            />
          )}

          {currentStep === "flash" && (
            <PlaceholderStep
              icon={Cpu}
              title="Flash Meshtastic firmware"
              description="Write the latest Meshtastic firmware to your ESP32 device over serial."
              phase="Phase 2"
            />
          )}

          {currentStep === "configure" && (
            <PlaceholderStep
              icon={Settings}
              title="Configure device for DCR34"
              description="Apply the DEF CON 34 mesh network configuration to your device automatically."
              phase="Phase 3"
            />
          )}

          {currentStep === "done" && (
            <PlaceholderStep
              icon={PartyPopper}
              title="Setup complete!"
              description="Your device is configured and ready for the DEF CON 34 mesh network."
              phase="Phase 3"
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
