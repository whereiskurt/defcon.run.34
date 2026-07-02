"use client";

import { useCallback, useRef } from "react";
import type { FlashProgress } from "@/types/serial";
import type { DeviceHardware, DeviceFamily } from "@/types/device";
import { getDeviceFamily } from "@/types/device";
import type { ESPLoader } from "esptool-js";
import type { DfuDevice } from "@/lib/web-dfu";
import { useFlashEsp32 } from "./use-flash-esp32";
import { useFlashNrf52 } from "./use-flash-nrf52";

export interface UseFlashReturn {
  /** Current flash progress state */
  progress: FlashProgress;
  /** Whether flash is currently in progress (any active stage) */
  isFlashing: boolean;
  /** Whether flash completed successfully */
  isComplete: boolean;
  /** Whether flash encountered an error */
  isError: boolean;
  /**
   * Start the flash pipeline for the given device family.
   *
   * The `transport` type is a discriminated union: ESP32 flashes take an
   * `ESPLoader` (from useSerial), nRF52 flashes take a `DfuDevice`
   * (from useDfu). The router selects the correct delegate by inspecting
   * `device.architecture` via `getDeviceFamily(device)`; unknown
   * architectures throw at that helper (fail-fast).
   *
   * @param transport - Claimed transport for the target family
   * @param device - Selected device (determines family + firmware file)
   * @param appendLog - Console log function
   */
  flash: (
    transport: ESPLoader | DfuDevice,
    device: DeviceHardware,
    appendLog: (text: string) => void
  ) => Promise<void>;
  /** Reset flash state to idle (for retry) */
  reset: () => void;
}

/**
 * Family-aware flash router.
 *
 * Per CONTEXT Decision 1 (extract-and-dispatch, not inline branch), this hook
 * calls BOTH delegate hooks unconditionally at the top level (React
 * rules-of-hooks) and picks whichever family's state to expose based on
 * which family was last dispatched to. Until the first `flash()` call the
 * ESP32 delegate's initial state is exposed (both hold `INITIAL_FLASH_PROGRESS`
 * on mount so the default state is identical).
 *
 * The public shape is preserved from the pre-phase useFlash so no consumers
 * need to change (SC4 zero-regression is enforced by construction —
 * `useFlashEsp32` is a byte-identical extract).
 */
export function useFlash(): UseFlashReturn {
  const esp32 = useFlashEsp32();
  const nrf52 = useFlashNrf52();

  // Track which family was last dispatched to so the returned progress /
  // isFlashing / isComplete / isError reflect the correct delegate. Defaults
  // to "esp32" — both delegates begin at INITIAL_FLASH_PROGRESS so the
  // pre-first-call state is family-neutral.
  const activeFamilyRef = useRef<DeviceFamily>("esp32");

  const flash = useCallback(
    async (
      transport: ESPLoader | DfuDevice,
      device: DeviceHardware,
      appendLog: (text: string) => void
    ) => {
      const family = getDeviceFamily(device);
      activeFamilyRef.current = family;
      if (family === "esp32") {
        return esp32.flash(transport as ESPLoader, device, appendLog);
      }
      return nrf52.flash(transport as DfuDevice, device, appendLog);
    },
    [esp32, nrf52]
  );

  const reset = useCallback(() => {
    esp32.reset();
    nrf52.reset();
  }, [esp32, nrf52]);

  const active = activeFamilyRef.current === "esp32" ? esp32 : nrf52;

  return {
    progress: active.progress,
    isFlashing: active.isFlashing,
    isComplete: active.isComplete,
    isError: active.isError,
    flash,
    reset,
  };
}
