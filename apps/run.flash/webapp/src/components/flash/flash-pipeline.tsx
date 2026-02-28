"use client";

import { Progress, Spinner } from "@heroui/react";
import {
  Eraser,
  HardDriveDownload,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Circle,
} from "lucide-react";
import clsx from "clsx";
import type { FlashProgress, FlashStage } from "@/types/serial";
import { formatBytes } from "@/config/firmware";

interface FlashPipelineProps {
  progress: FlashProgress;
}

type StageStatus = "pending" | "active" | "complete" | "error";

function getStageStatus(
  targetStage: FlashStage,
  progress: FlashProgress
): StageStatus {
  const order: FlashStage[] = ["erasing", "writing", "verifying"];
  const currentIdx = order.indexOf(progress.stage);
  const targetIdx = order.indexOf(targetStage);

  if (progress.stage === "complete") return "complete";
  if (progress.stage === "error") {
    if (currentIdx === targetIdx) return "error";
    if (targetIdx < currentIdx) return "complete";
    return "pending";
  }

  // For erase stage, use eraseComplete flag
  if (targetStage === "erasing") {
    if (progress.eraseComplete) return "complete";
    if (progress.stage === "erasing") return "active";
    return "pending";
  }

  // For write stage
  if (targetStage === "writing") {
    if (progress.writePercent >= 100 && progress.stage !== "writing")
      return "complete";
    if (progress.stage === "writing") return "active";
    if (progress.eraseComplete && currentIdx < targetIdx) return "pending";
    return "pending";
  }

  // For verify stage
  if (targetStage === "verifying") {
    if (progress.verifyComplete) return "complete";
    if (progress.stage === "verifying") return "active";
    return "pending";
  }

  return "pending";
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "complete")
    return <CheckCircle2 className="w-5 h-5 text-green-400" />;
  if (status === "error") return <XCircle className="w-5 h-5 text-danger" />;
  if (status === "active") return <Spinner size="sm" color="primary" />;
  return <Circle className="w-5 h-5 text-default-600" />;
}

function PipelineStage({
  icon: Icon,
  label,
  activeLabel,
  completeLabel,
  status,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  activeLabel: string;
  completeLabel: string;
  status: StageStatus;
  children?: React.ReactNode;
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
            status === "complete" && "text-green-400",
            status === "active" && "text-primary",
            status === "error" && "text-danger",
            status === "pending" && "text-default-600"
          )}
        />
      </div>

      {/* Stage content (center) */}
      <div className="flex-1 min-w-0">
        <p
          className={clsx(
            "text-sm font-mono",
            status === "complete" && "text-green-400",
            status === "active" && "text-primary",
            status === "error" && "text-danger",
            status === "pending" && "text-default-600"
          )}
        >
          {text}
        </p>
        {children}
      </div>

      {/* Status indicator (right) */}
      <div className="flex-shrink-0 w-6 flex items-center justify-center pt-0.5">
        <StageIcon status={status} />
      </div>
    </div>
  );
}

/**
 * Three-stage flash pipeline visualization: Erase -> Write -> Verify.
 * Per CONTEXT.md: stages light up green with checkmarks as they complete.
 * Write stage shows detailed percentage bar with bytes transferred.
 */
export function FlashPipeline({ progress }: FlashPipelineProps) {
  const eraseStatus = getStageStatus("erasing", progress);
  const writeStatus = getStageStatus("writing", progress);
  const verifyStatus = getStageStatus("verifying", progress);

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="relative">
        {/* Vertical connecting line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px">
          <div
            className={clsx(
              "w-full h-full",
              progress.stage === "complete"
                ? "bg-green-400/40"
                : "bg-default-700/40"
            )}
          />
        </div>

        {/* Stage 1: Erase */}
        <PipelineStage
          icon={Eraser}
          label="Erase flash"
          activeLabel="Erasing flash..."
          completeLabel="Flash erased"
          status={eraseStatus}
        />

        {/* Stage 2: Write */}
        <PipelineStage
          icon={HardDriveDownload}
          label="Write firmware"
          activeLabel={`Writing firmware... ${progress.writePercent}% (${formatBytes(progress.writtenBytes)} / ${formatBytes(progress.totalBytes)})`}
          completeLabel="Firmware written"
          status={writeStatus}
        >
          {writeStatus === "active" && (
            <Progress
              value={progress.writePercent}
              color="primary"
              size="sm"
              className="mt-2"
              aria-label="Write progress"
            />
          )}
        </PipelineStage>

        {/* Stage 3: Verify */}
        <PipelineStage
          icon={ShieldCheck}
          label="Verify firmware"
          activeLabel="Verifying firmware..."
          completeLabel="Firmware verified"
          status={verifyStatus}
        />
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
