"use client";

import { Card, CardBody } from "@heroui/react";
import { AlertTriangle } from "lucide-react";
import { useCopy } from "@/components/CopyProvider";
import { renderMono } from "@/lib/copy-mono";

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
 *
 * Copy is sourced from the CMS catalog (`flash.mismatch.*`). The detected/
 * expected hardware identifiers (chip name, VID:PID, device name, arch) are
 * `{token}` placeholders rendered back into `font-mono text-foreground` spans
 * via renderMono — the same on-device emphasis the #722 readability pass set,
 * but now editor-editable.
 */
export function ChipMismatchWarning({
  detectedChipName,
  detectedVidPid,
  expectedArchitecture,
  deviceName,
}: ChipMismatchWarningProps) {
  const { t } = useCopy();
  const isNrf52Surface = !!detectedVidPid && !detectedChipName;

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardBody className="flex flex-col items-center gap-3 p-5 text-center">
        <AlertTriangle className="w-10 h-10 text-warning" />
        <h3 className="text-lg font-bold text-warning">
          {isNrf52Surface
            ? t("flash.mismatch.nrf52.title")
            : t("flash.mismatch.esp32.title")}
        </h3>
        {isNrf52Surface ? (
          <p className="text-sm text-default-400 max-w-md">
            {renderMono(t("flash.mismatch.nrf52.body"), {
              vidpid: detectedVidPid ?? "",
              device: deviceName,
              arch: expectedArchitecture,
            })}
          </p>
        ) : (
          <p className="text-sm text-default-400 max-w-md">
            {renderMono(t("flash.mismatch.esp32.body"), {
              chip: detectedChipName ?? "",
              device: deviceName,
              arch: expectedArchitecture,
            })}
          </p>
        )}
        <p className="text-sm text-default-500 max-w-md">
          {renderMono(t("flash.mismatch.action"), { device: deviceName })}
        </p>
      </CardBody>
    </Card>
  );
}
