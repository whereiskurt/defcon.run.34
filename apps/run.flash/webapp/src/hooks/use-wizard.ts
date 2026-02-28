"use client";

import { useState, useCallback } from "react";
import type { DeviceHardware } from "@/types/device";

export type WizardStep =
  | "pick-device"
  | "connect"
  | "flash"
  | "configure"
  | "done";

export const STEPS: WizardStep[] = [
  "pick-device",
  "connect",
  "flash",
  "configure",
  "done",
];

export const STEP_LABELS: Record<WizardStep, string> = {
  "pick-device": "Pick Device",
  connect: "Connect",
  flash: "Flash",
  configure: "Configure",
  done: "Done",
};

interface WizardState {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  selectedDevice: DeviceHardware | null;
}

export function useWizard() {
  const [state, setState] = useState<WizardState>({
    currentStep: "pick-device",
    completedSteps: new Set(),
    selectedDevice: null,
  });

  const canAdvance = useCallback(
    (step: WizardStep): boolean => {
      const currentIndex = STEPS.indexOf(step);
      if (currentIndex === 0) return state.selectedDevice !== null;
      // For all other steps, the previous step must be completed
      return state.completedSteps.has(STEPS[currentIndex - 1]);
    },
    [state.selectedDevice, state.completedSteps]
  );

  const advance = useCallback(() => {
    setState((prev) => {
      if (!canAdvance(prev.currentStep)) return prev;
      const currentIndex = STEPS.indexOf(prev.currentStep);
      if (currentIndex >= STEPS.length - 1) return prev;

      const newCompleted = new Set(prev.completedSteps);
      newCompleted.add(prev.currentStep);

      return {
        ...prev,
        completedSteps: newCompleted,
        currentStep: STEPS[currentIndex + 1],
      };
    });
  }, [canAdvance]);

  const goToStep = useCallback((step: WizardStep) => {
    setState((prev) => {
      // Only allow navigation to completed steps (back navigation)
      if (!prev.completedSteps.has(step)) return prev;
      return { ...prev, currentStep: step };
    });
  }, []);

  const selectDevice = useCallback((device: DeviceHardware) => {
    setState((prev) => ({ ...prev, selectedDevice: device }));
  }, []);

  const clearDevice = useCallback(() => {
    setState((prev) => ({ ...prev, selectedDevice: null }));
  }, []);

  return {
    currentStep: state.currentStep,
    completedSteps: state.completedSteps,
    selectedDevice: state.selectedDevice,
    canAdvance,
    advance,
    goToStep,
    selectDevice,
    clearDevice,
    steps: STEPS,
    stepLabels: STEP_LABELS,
  };
}
