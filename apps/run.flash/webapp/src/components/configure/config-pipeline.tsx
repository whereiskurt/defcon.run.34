"use client";

import { Spinner } from "@heroui/react";
import {
  Radio,
  Hash,
  UserCircle2,
  Signal,
  Bell,
  CheckCircle2,
  XCircle,
  Circle,
} from "lucide-react";
import clsx from "clsx";
import type { ConfigProgress, ConfigStage } from "@/types/config";

type StageStatus = "pending" | "active" | "complete" | "error";

/** The four user-visible config stages (connecting/committing are internal) */
interface DisplayStage {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  activeLabel: string;
  /** Build the complete label from stage summaries */
  completeLabel: (summaries: ConfigProgress["stageSummaries"]) => string;
  /** Which ConfigStage values map to "active" for this display stage */
  activeStages: ConfigStage[];
  /** Which ConfigStage values must be in completedStages for "complete" */
  completeStages: ConfigStage[];
}

/** Display stages in push order: Radio first (region needed on fresh flash),
 *  then MQTT, Channels, Identity. Committing is grouped with Identity. */
const DISPLAY_STAGES: DisplayStage[] = [
  {
    key: "radio",
    icon: Signal,
    label: "Radio",
    activeLabel: "Configuring radio...",
    completeLabel: (s) => `Radio: ${s.radio ?? "configured"}`,
    activeStages: ["radio"],
    completeStages: ["radio"],
  },
  {
    key: "mqtt",
    icon: Radio,
    label: "MQTT",
    activeLabel: "Configuring MQTT...",
    completeLabel: (s) => `MQTT: ${s.mqtt ?? "configured"}`,
    activeStages: ["mqtt"],
    completeStages: ["mqtt"],
  },
  {
    key: "channels",
    icon: Hash,
    label: "Channels",
    activeLabel: "Configuring channels...",
    completeLabel: (s) => `Channels: ${s.channels ?? "configured"}`,
    activeStages: ["channels"],
    completeStages: ["channels"],
  },
  {
    key: "identity",
    icon: UserCircle2,
    label: "Identity",
    activeLabel: "Setting identity...",
    completeLabel: (s) => `Identity: ${s.identity ?? "configured"}`,
    activeStages: ["identity"],
    completeStages: ["identity"],
  },
  {
    key: "ringtone",
    icon: Bell,
    label: "Ringtone",
    activeLabel: "Setting ringtone...",
    completeLabel: () => "Ringtone: set",
    activeStages: ["ringtone", "committing"],
    completeStages: ["ringtone", "committing"],
  },
];

function getStageStatus(
  displayStage: DisplayStage,
  progress: ConfigProgress
): StageStatus {
  // All complete when overall progress is complete
  if (progress.stage === "complete") return "complete";

  // Check if all required stages are in completedStages
  const allComplete = displayStage.completeStages.every((s) =>
    progress.completedStages.includes(s)
  );
  if (allComplete) return "complete";

  // Error: if we're in error state and this stage was active
  if (progress.stage === "error") {
    if (displayStage.activeStages.includes(progress.stage as ConfigStage)) {
      return "error";
    }
    // Check if any of the active stages match the last non-error stage
    // If not complete but we're in error, show as error for the current stage
    // or pending for future stages
    return "pending";
  }

  // Active: current stage matches one of the display stage's active stages
  if (displayStage.activeStages.includes(progress.stage)) return "active";

  return "pending";
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "complete")
    return <CheckCircle2 className="w-5 h-5 text-primary" />;
  if (status === "error") return <XCircle className="w-5 h-5 text-danger" />;
  if (status === "active") return <Spinner size="sm" classNames={{ circle1: "border-b-teal-400", circle2: "border-b-teal-400" }} />;
  return <Circle className="w-5 h-5 text-default-600" />;
}

function PipelineStage({
  icon: Icon,
  label,
  activeLabel,
  completeLabel,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  activeLabel: string;
  completeLabel: string;
  status: StageStatus;
}) {
  const text =
    status === "complete"
      ? completeLabel
      : status === "active"
        ? activeLabel
        : status === "error"
          ? activeLabel
          : label;

  return (
    <div className="flex items-start gap-3 py-2">
      {/* Stage icon (left gutter) */}
      <div className="flex-shrink-0 w-8 flex items-center justify-center pt-0.5">
        <Icon
          className={clsx(
            "w-5 h-5",
            status === "complete" && "text-primary",
            status === "active" && "text-primary",
            status === "error" && "text-danger",
            status === "pending" && "text-default-600"
          )}
        />
      </div>

      {/* Stage content + inline status indicator */}
      <div className="flex-1 min-w-0">
        <span
          className={clsx(
            "text-sm font-mono inline-flex items-center gap-2",
            status === "complete" && "text-primary",
            status === "active" && "text-primary",
            status === "error" && "text-danger",
            status === "pending" && "text-default-600"
          )}
        >
          {text}
          <StageIcon status={status} />
        </span>
      </div>
    </div>
  );
}

interface ConfigPipelineProps {
  progress: ConfigProgress;
}

/**
 * Four-stage config pipeline visualization: MQTT -> Channels -> Identity -> Radio.
 * Per CONTEXT.md: stages light up teal with checkmarks as they complete.
 * Each complete stage shows category + summary value (no secrets).
 * Matches FlashPipeline visual language: glass-card, teal-400, font-mono.
 */
export function ConfigPipeline({ progress }: ConfigPipelineProps) {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="relative">
        {/* Vertical connecting line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px">
          <div
            className={clsx(
              "w-full h-full",
              progress.stage === "complete"
                ? "bg-teal-400/40"
                : "bg-default-700/40"
            )}
          />
        </div>

        {DISPLAY_STAGES.map((displayStage) => {
          const status = getStageStatus(displayStage, progress);
          return (
            <PipelineStage
              key={displayStage.key}
              icon={displayStage.icon}
              label={displayStage.label}
              activeLabel={displayStage.activeLabel}
              completeLabel={displayStage.completeLabel(
                progress.stageSummaries
              )}
              status={status}
            />
          );
        })}
      </div>

      {/* Error message below pipeline */}
      {progress.stage === "error" && progress.error && (
        <div className="mt-3 pt-3 border-t border-danger/20">
          <p className="text-sm text-danger font-mono">{progress.error}</p>
        </div>
      )}
    </div>
  );
}
