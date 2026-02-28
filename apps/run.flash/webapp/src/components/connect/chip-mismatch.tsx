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
 * Per CONTEXT.md: mismatch blocks flash with clear warning.
 * This component has no proceed button -- mismatch blocks flash entirely.
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
          The connected chip (
          <span className="font-mono text-default-200">{detectedChipName}</span>
          ) doesn&apos;t match the selected device (
          <span className="font-mono text-default-200">{deviceName}</span> /{" "}
          <span className="font-mono text-default-200">
            {expectedArchitecture}
          </span>
          ). Flashing the wrong firmware could brick your device.
        </p>
        <p className="text-xs text-default-500">
          Please disconnect, verify you&apos;ve selected the correct device in
          the picker, and try again.
        </p>
      </CardBody>
    </Card>
  );
}
