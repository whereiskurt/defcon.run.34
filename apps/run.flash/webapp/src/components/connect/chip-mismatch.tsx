"use client";

import { Card, CardBody } from "@heroui/react";
import { AlertTriangle } from "lucide-react";

interface ChipMismatchWarningProps {
  detectedChipName: string;
  expectedArchitecture: string;
  deviceName: string;
}

/**
 * Chip architecture mismatch warning.
 *
 * Per CONTEXT.md and Phase 19-02 (BRND-02): mismatch blocks flash entirely
 * (no proceed button). Copy names both the concrete failure (detected vs.
 * expected chip family) and the single corrective action (return to picker).
 */
export function ChipMismatchWarning({
  detectedChipName,
  expectedArchitecture,
  deviceName,
}: ChipMismatchWarningProps) {
  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardBody className="flex flex-col items-center gap-3 p-5 text-center">
        <AlertTriangle className="w-10 h-10 text-warning" />
        <h3 className="text-lg font-bold text-warning">
          Chip Mismatch Detected
        </h3>
        <p className="text-sm text-default-400 max-w-md">
          The connected chip is a{" "}
          <span className="font-mono text-default-200">{detectedChipName}</span>{" "}
          but the picker says you selected{" "}
          <span className="font-mono text-default-200">{deviceName}</span> (
          <span className="font-mono text-default-200">
            {expectedArchitecture}
          </span>
          ) &mdash; flashing this firmware to the wrong chip could brick the
          device.
        </p>
        <p className="text-sm text-default-300 max-w-md">
          Return to the device picker and select the correct device &mdash; or
          disconnect this board and connect the one that matches{" "}
          <span className="font-mono text-default-200">{deviceName}</span>.
        </p>
      </CardBody>
    </Card>
  );
}
