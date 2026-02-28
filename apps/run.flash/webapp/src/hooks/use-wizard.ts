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

/**
 * Parse ?step= URL param to allow jumping ahead in the wizard.
 * Use case: flash succeeded but page reloaded — user can jump to
 * ?step=configure to skip re-flashing (still needs to connect).
 *
 * When jumping ahead, all prior steps are marked completed so the
 * stepper shows them as done.
 */
function getInitialState(): { step: WizardStep; completed: Set<WizardStep> } {
  if (typeof window === "undefined") {
    return { step: "pick-device", completed: new Set() };
  }
  const params = new URLSearchParams(window.location.search);
  const stepParam = params.get("step") as WizardStep | null;

  if (stepParam && STEPS.includes(stepParam)) {
    const targetIndex = STEPS.indexOf(stepParam);
    // Jump to "connect" — user must reconnect to the device.
    // Mark all steps before the target AND the flash step as completed
    // so advance() skips flash and goes straight to the target.
    // e.g., ?step=configure → connect step, with pick-device + flash done.
    //        After connecting, advance() skips flash → lands on configure.
    const completed = new Set<WizardStep>();
    completed.add("pick-device"); // always skip device picker on jump
    for (let i = 2; i < targetIndex; i++) {
      completed.add(STEPS[i]); // mark intermediate steps done
    }
    // Mark the target's preceding steps (except connect) as done
    if (targetIndex > 2) {
      completed.add("flash"); // skip re-flashing
    }
    return { step: "connect" as WizardStep, completed };
  }
  return { step: "pick-device", completed: new Set() };
}

interface WizardState {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  selectedDevice: DeviceHardware | null;
}

export function useWizard() {
  const [state, setState] = useState<WizardState>(() => {
    const initial = getInitialState();
    return {
      currentStep: initial.step,
      completedSteps: initial.completed,
      selectedDevice: null,
    };
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

      // Skip over already-completed steps (supports ?step= URL jump)
      let nextIndex = currentIndex + 1;
      while (nextIndex < STEPS.length - 1 && newCompleted.has(STEPS[nextIndex])) {
        nextIndex++;
      }

      return {
        ...prev,
        completedSteps: newCompleted,
        currentStep: STEPS[nextIndex],
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

  /**
   * Navigate to a step for retry, removing it and all subsequent steps
   * from completedSteps. Used by flash retry flow: go back to Connect
   * with a clean slate so the step must be re-completed.
   */
  const goToStepForRetry = useCallback((step: WizardStep) => {
    setState((prev) => {
      const newCompleted = new Set(prev.completedSteps);
      const stepIndex = STEPS.indexOf(step);
      for (let i = stepIndex; i < STEPS.length; i++) {
        newCompleted.delete(STEPS[i]);
      }
      return { ...prev, currentStep: step, completedSteps: newCompleted };
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
    goToStepForRetry,
    selectDevice,
    clearDevice,
    steps: STEPS,
    stepLabels: STEP_LABELS,
  };
}
