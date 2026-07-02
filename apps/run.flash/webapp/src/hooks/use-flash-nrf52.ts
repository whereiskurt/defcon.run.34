"use client";

// STUB — Plan 24-02 replaces the flash body with the Web USB DFU write path.
//
// Shape mirrors useFlashEsp32 so the router (use-flash.ts) can compose both
// without special-casing. The transport argument is `unknown` here; Plan 24-02
// will narrow it to a concrete DfuDevice type once the library shootout picks
// a winner (dfu-util-js / web-dfu / nrf-dfu-js) or the custom src/lib/web-dfu.ts
// lands. Per CONTEXT Decision 6, nRF52 flashes as a 2-stage pipeline
// (writing -> verifying) because the Adafruit bootloader handles erase as part
// of DFU_DNLOAD; we seed `eraseComplete: true` in Plan 24-02 to reflect that.

import { useState, useCallback } from "react";
import type { FlashProgress } from "@/types/serial";
import { INITIAL_FLASH_PROGRESS } from "@/types/serial";
import type { DeviceHardware } from "@/types/device";

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
   * Requires a claimed DFU transport (Plan 24-02 replaces `unknown` with
   * the concrete DfuDevice type).
   *
   * @param transport - Claimed DFU transport (Plan 24-02: DfuDevice)
   * @param device - Selected device (determines .uf2 file to load)
   * @param appendLog - Console log function
   */
  flash: (
    transport: unknown,
    device: DeviceHardware,
    appendLog: (text: string) => void
  ) => Promise<void>;
  /** Reset flash state to idle (for retry) */
  reset: () => void;
}

/**
 * STUB hook for the nRF52 flash pipeline.
 *
 * Plan 24-01 lands this stub so the router in use-flash.ts can compile and
 * dispatch by family. Plan 24-02 fills in the Web USB DFU write path against
 * the T-1000E's Adafruit-family bootloader.
 */
export function useFlashNrf52(): UseFlashNrf52Return {
  const [progress, setProgress] =
    useState<FlashProgress>(INITIAL_FLASH_PROGRESS);

  const flash = useCallback(
    async (
      _transport: unknown,
      _device: DeviceHardware,
      appendLog: (text: string) => void
    ) => {
      const message = "nRF52 flash not yet implemented — Plan 24-02";
      appendLog(`\nERROR: ${message}\n`);
      setProgress((prev) => ({
        ...prev,
        stage: "error",
        error: message,
      }));
      throw new Error(message);
    },
    []
  );

  const reset = useCallback(() => {
    setProgress(INITIAL_FLASH_PROGRESS);
  }, []);

  return {
    progress,
    isFlashing:
      progress.stage === "erasing" ||
      progress.stage === "writing" ||
      progress.stage === "verifying",
    isComplete: progress.stage === "complete",
    isError: progress.stage === "error",
    flash,
    reset,
  };
}
