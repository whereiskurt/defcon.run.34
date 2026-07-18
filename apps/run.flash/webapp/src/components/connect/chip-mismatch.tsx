"use client";

import { Card, CardBody } from "@heroui/react";
import { AlertTriangle } from "lucide-react";

interface ChipMismatchWarningProps {
  /** Chip name reported by esptool (ESP32 path). Optional so the nRF52 path
   *  can pass `detectedVidPid` instead — DFU class doesn't expose an
   *  esptool-style chip identifier. */
  detectedChipName?: string;
  /** USB VID:PID hex string reported by the DFU device (nRF52 path).
   *  When present, the mismatch surface renders this in place of a
   *  chip name and re-frames the check as "USB device family". */
  detectedVidPid?: string;
  expectedArchitecture: string;
  deviceName: string;
}

/**
 * Chip / USB-device architecture mismatch warning.
 *
 * Per CONTEXT.md and Phase 19-02 (BRND-02): mismatch blocks flash entirely
 * (no proceed button). Copy names both the concrete failure (detected vs.
 * expected chip family) and the single corrective action (return to picker).
 *
 * Per Phase 25 (Plan 25-02-02): for nRF52 devices the flasher only has a
 * USB VID/PID to identify the connected board (DFU class doesn't report
 * an esptool-style chip name), so the copy is family-aware:
 *   - ESP32 path (`detectedChipName` present) → "connected chip is …"
 *   - nRF52 path (`detectedVidPid` present)   → "connected USB device
 *     reports VID/PID …"
 * The ESP32 branch is byte-identical to pre-Phase-25 copy (regression
 * guard for SC5).
 */
export function ChipMismatchWarning({
  detectedChipName,
  detectedVidPid,
  expectedArchitecture,
  deviceName,
}: ChipMismatchWarningProps) {
  const isNrf52Surface = !!detectedVidPid && !detectedChipName;

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardBody className="flex flex-col items-center gap-3 p-5 text-center">
        <AlertTriangle className="w-10 h-10 text-warning" />
        <h3 className="text-lg font-bold text-warning">
          {isNrf52Surface
            ? "USB Device Family Mismatch"
            : "Chip Mismatch Detected"}
        </h3>
        {isNrf52Surface ? (
          <p className="text-sm text-default-400 max-w-md">
            The connected USB device reports VID/PID{" "}
            <span className="font-mono text-foreground">
              {detectedVidPid}
            </span>
            , but the picker says you selected{" "}
            <span className="font-mono text-foreground">{deviceName}</span> (
            <span className="font-mono text-foreground">
              {expectedArchitecture}
            </span>
            ) &mdash; flashing this firmware to the wrong USB device family
            could brick the device.
          </p>
        ) : (
          <p className="text-sm text-default-400 max-w-md">
            The connected chip is a{" "}
            <span className="font-mono text-foreground">{detectedChipName}</span>{" "}
            but the picker says you selected{" "}
            <span className="font-mono text-foreground">{deviceName}</span> (
            <span className="font-mono text-foreground">
              {expectedArchitecture}
            </span>
            ) &mdash; flashing this firmware to the wrong chip could brick the
            device.
          </p>
        )}
        <p className="text-sm text-default-500 max-w-md">
          Return to the device picker and select the correct device &mdash; or
          disconnect this board and connect the one that matches{" "}
          <span className="font-mono text-foreground">{deviceName}</span>.
        </p>
      </CardBody>
    </Card>
  );
}
