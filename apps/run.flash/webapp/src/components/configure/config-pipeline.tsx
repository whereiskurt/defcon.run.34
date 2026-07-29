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
import { useCopy } from "@/components/CopyProvider";

type StageStatus = "pending" | "active" | "complete" | "error";

/** Bound copy lookup from useCopy — threaded into DISPLAY_STAGES (module-level
 *  const, no hook) so each stage's labels resolve from the CMS catalog. */
type CopyFn = (key: string, vars?: Record<string, string | number>) => string;

/** The four user-visible config stages (connecting/committing are internal) */
interface DisplayStage {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  /** CMS key for the pending/idle label (e.g. "Radio"). */
  labelKey: string;
  /** CMS key for the in-progress label (e.g. "Configuring radio..."). */
  activeKey: string;
  /** Build the complete label from CMS copy + stage summaries. The summary
   *  value (e.g. the configured region) is dynamic hardware state, injected
   *  into the CMS template via a {summary} interpolation var. */
  completeLabel: (t: CopyFn, summaries: ConfigProgress["stageSummaries"]) => string;
  /** Which ConfigStage values map to "active" for this display stage */
  activeStages: ConfigStage[];
  /** Which ConfigStage values must be in completedStages for "complete" */
  completeStages: ConfigStage[];
}

/** Display stages in push order: Identity first — it un-licenses HAM-default
 *  boards (T-Beam BPF) BEFORE the region write, which on a licensed device
 *  triggers a node-number migration that orphans all later writes, and a
 *  licensed device also strips channel PSKs on write. Then Radio (region
 *  needed on fresh flash), MQTT, Channels. Committing is grouped with
 *  Ringtone. */
const DISPLAY_STAGES: DisplayStage[] = [
  {
    key: "identity",
    icon: UserCircle2,
    labelKey: "flash.configStage.identity.label",
    activeKey: "flash.configStage.identity.active",
    completeLabel: (t, s) =>
      t("flash.configStage.identity.complete", {
        summary: s.identity ?? t("flash.configStage.configuredFallback"),
      }),
    activeStages: ["identity"],
    completeStages: ["identity"],
  },
  {
    key: "radio",
    icon: Signal,
    labelKey: "flash.configStage.radio.label",
    activeKey: "flash.configStage.radio.active",
    completeLabel: (t, s) =>
      t("flash.configStage.radio.complete", {
        summary: s.radio ?? t("flash.configStage.configuredFallback"),
      }),
    activeStages: ["radio"],
    completeStages: ["radio"],
  },
  {
    key: "mqtt",
    icon: Radio,
    labelKey: "flash.configStage.mqtt.label",
    activeKey: "flash.configStage.mqtt.active",
    completeLabel: (t, s) =>
      t("flash.configStage.mqtt.complete", {
        summary: s.mqtt ?? t("flash.configStage.configuredFallback"),
      }),
    activeStages: ["mqtt"],
    completeStages: ["mqtt"],
  },
  {
    key: "channels",
    icon: Hash,
    labelKey: "flash.configStage.channels.label",
    activeKey: "flash.configStage.channels.active",
    completeLabel: (t, s) =>
      t("flash.configStage.channels.complete", {
        summary: s.channels ?? t("flash.configStage.configuredFallback"),
      }),
    activeStages: ["channels"],
    completeStages: ["channels"],
  },
  {
    key: "ringtone",
    icon: Bell,
    labelKey: "flash.configStage.ringtone.label",
    activeKey: "flash.configStage.ringtone.active",
    completeLabel: (t) => t("flash.configStage.ringtone.complete"),
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
  const { t } = useCopy();
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
              label={t(displayStage.labelKey)}
              activeLabel={t(displayStage.activeKey)}
              completeLabel={displayStage.completeLabel(
                t,
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
