"use client";

import { Check } from "lucide-react";
import clsx from "clsx";
import { STEPS, STEP_LABELS } from "@/hooks/use-wizard";
import type { WizardStep } from "@/hooks/use-wizard";

interface WizardStepperProps {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  onStepClick: (step: WizardStep) => void;
  /** Steps to render. Defaults to the full list; nRF52 omits "connect". */
  steps?: WizardStep[];
}

export function WizardStepper({
  currentStep,
  completedSteps,
  onStepClick,
  steps = STEPS,
}: WizardStepperProps) {
  return (
    <div className="flex items-center w-full py-4 px-2">
      {steps.map((step, index) => {
        const isCurrent = step === currentStep;
        const isCompleted = completedSteps.has(step);
        const isClickable = isCompleted;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            {/* Step circle + label */}
            <button
              type="button"
              onClick={() => isClickable && onStepClick(step)}
              disabled={!isClickable && !isCurrent}
              className={clsx(
                "flex items-center gap-2 rounded-lg transition-all shrink-0",
                isCurrent && "text-primary",
                isCompleted &&
                  "text-primary cursor-pointer hover:bg-content2 px-2 py-1",
                !isCurrent &&
                  !isCompleted &&
                  "text-default-400 cursor-not-allowed opacity-50"
              )}
            >
              <div
                className={clsx(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono border shrink-0",
                  isCurrent &&
                    "border-primary text-primary bg-primary/10 shadow-[0_0_12px_#00d4aa30]",
                  isCompleted &&
                    "border-primary bg-primary text-primary-foreground",
                  !isCurrent &&
                    !isCompleted &&
                    "border-default-400 text-default-400"
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={clsx(
                  "hidden sm:inline text-sm whitespace-nowrap",
                  isCurrent && "font-medium"
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </button>

            {/* Connecting line */}
            {index < steps.length - 1 && (
              <div
                className={clsx(
                  "flex-1 h-px mx-2 min-w-4",
                  isCompleted ? "bg-primary" : "bg-default-300/30",
                  !isCompleted && "border-t border-dashed border-default-300/30 bg-transparent"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
