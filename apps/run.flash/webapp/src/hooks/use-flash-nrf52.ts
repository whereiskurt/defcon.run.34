"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { FlashProgress } from "@/types/serial";
import { INITIAL_FLASH_PROGRESS } from "@/types/serial";
import { loadUf2, formatBytes } from "@/config/firmware";
import type { DeviceHardware } from "@/types/device";
import type { DfuDevice } from "@/lib/web-dfu";
import { dfuWrite, dfuVerify } from "@/lib/web-dfu";

export interface UseFlashNrf52Return {
  /** Current flash progress state */
  progress: FlashProgress;
  /** Whether flash is currently in progress (any active stage) */
  isFlashing: boolean;
  /** Whether flash completed successfully */
  isComplete: boolean;
  /** Whether flash encountered an error */
  isError: boolean;
  /**
   * Start the nRF52 Web USB DFU flash pipeline: write -> verify.
   * Requires a claimed DfuDevice (from useDfu).
   *
   * @param dfuDevice - Claimed DFU transport from useDfu
   * @param device - Selected device (determines .uf2 file to load)
   * @param appendLog - Console log function
   */
  flash: (
    dfuDevice: DfuDevice,
    device: DeviceHardware,
    appendLog: (text: string) => void
  ) => Promise<void>;
  /** Reset flash state to idle (for retry) */
  reset: () => void;
}

/**
 * The Plan-24-02-seeded initial state for the nRF52 flash pipeline.
 *
 * Per CONTEXT Decision 6: seed `eraseComplete: true` from the start so the
 * pipeline UI can either render a "handled by bootloader" segment or skip
 * the erase step entirely — the Adafruit bootloader handles erase as part
 * of DFU_DNLOAD, and forcing a fake erase stage would either lie or confuse.
 */
const NRF52_INITIAL_PROGRESS: FlashProgress = {
  ...INITIAL_FLASH_PROGRESS,
  eraseComplete: true,
};

/**
 * Hook for orchestrating the nRF52 Web USB DFU flash pipeline.
 *
 * Two-stage pipeline (Plan 24-02):
 * 1. WRITE: DFU_DNLOAD .uf2 firmware in transferSize chunks (web-dfu.dfuWrite)
 * 2. VERIFY: DFU_GETSTATUS confirms bStatus=OK and bState=dfuIDLE (web-dfu.dfuVerify)
 *
 * No explicit erase stage — the Adafruit nRF52 bootloader handles erase as
 * part of DFU_DNLOAD. `eraseComplete` is seeded `true` from mount so consumers
 * that render a family-agnostic pipeline component see a green "erase done"
 * checkbox rather than an infinite pending state.
 */
export function useFlashNrf52(): UseFlashNrf52Return {
  const [progress, setProgress] = useState<FlashProgress>(NRF52_INITIAL_PROGRESS);
  const isFlashingRef = useRef(false);

  const flash = useCallback(
    async (
      dfuDevice: DfuDevice,
      device: DeviceHardware,
      appendLog: (text: string) => void
    ) => {
      if (isFlashingRef.current) return;
      isFlashingRef.current = true;

      try {
        appendLog(`Loading firmware for ${device.displayName}...\n`);
        const firmware = await loadUf2(device);
        appendLog(
          `Firmware loaded: ${firmware.filename} (${formatBytes(firmware.size)})\n\n`
        );

        // ---- Stage 1: WRITE ----
        appendLog("=== Stage 1/2: Writing firmware over DFU ===\n");
        setProgress({
          stage: "writing",
          eraseComplete: true,
          writePercent: 0,
          writtenBytes: 0,
          totalBytes: firmware.size,
          verifyComplete: false,
          error: null,
        });

        await dfuWrite(dfuDevice, firmware.data, (written, total) => {
          const percent = Math.round((written / total) * 100);
          setProgress((prev) => ({
            ...prev,
            writePercent: percent,
            writtenBytes: written,
            totalBytes: total,
          }));
        });

        appendLog(
          `\nFirmware write complete: ${formatBytes(firmware.size)} written.\n\n`
        );
        setProgress((prev) => ({
          ...prev,
          writePercent: 100,
          writtenBytes: firmware.size,
        }));

        // ---- Stage 2: VERIFY ----
        appendLog("=== Stage 2/2: Verifying DFU status ===\n");
        setProgress((prev) => ({
          ...prev,
          stage: "verifying",
        }));

        await dfuVerify(dfuDevice);

        appendLog("DFU status OK — device is in dfuIDLE.\n\n");

        setProgress({
          stage: "complete",
          eraseComplete: true,
          writePercent: 100,
          writtenBytes: firmware.size,
          totalBytes: firmware.size,
          verifyComplete: true,
          error: null,
        });

        appendLog("=== Flash complete! ===\n");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown DFU flash error";
        appendLog(`\nERROR: ${message}\n`);

        setProgress((prev) => ({
          ...prev,
          stage: "error",
          error: message,
        }));
      } finally {
        isFlashingRef.current = false;
      }
    },
    []
  );

  // Prevent accidental page navigation during flash (HMR, refresh, close tab).
  // No "erasing" stage for nRF52 — bootloader handles erase inside DFU_DNLOAD.
  useEffect(() => {
    const isActive =
      progress.stage === "writing" || progress.stage === "verifying";
    if (!isActive) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [progress.stage]);

  const reset = useCallback(() => {
    // Preserve the family-specific eraseComplete: true seed on reset.
    setProgress(NRF52_INITIAL_PROGRESS);
    isFlashingRef.current = false;
  }, []);

  return {
    progress,
    isFlashing:
      progress.stage === "writing" || progress.stage === "verifying",
    isComplete: progress.stage === "complete",
    isError: progress.stage === "error",
    flash,
    reset,
  };
}
