/**
 * Serial connection and flash state types for the Meshtastic flasher.
 * These types are consumed by useSerial, useFlash hooks and UI components.
 */

/** Information about the connected ESP32 chip */
export interface ChipInfo {
  /** Chip family name, e.g., "ESP32-S3" (from espLoader.chip.CHIP_NAME) */
  chipName: string;
  /** Detailed chip description (from espLoader.chip.getChipDescription) */
  chipDescription: string;
}

/** Serial connection state machine */
export type SerialConnectionState =
  | "disconnected" // No serial port selected
  | "connecting" // Port selected, initializing Transport + ESPLoader
  | "connected" // ESPLoader synced, chip detected
  | "error"; // Connection failed

/** Flash pipeline stage */
export type FlashStage =
  | "idle" // Not started
  | "erasing" // Erasing flash (stage 1 of 3)
  | "writing" // Writing firmware (stage 2 of 3)
  | "verifying" // MD5 verification (stage 3 of 3)
  | "complete" // All stages succeeded
  | "error"; // Any stage failed

/** Progress state for the flash pipeline */
export interface FlashProgress {
  stage: FlashStage;
  /** Whether erase stage has completed */
  eraseComplete: boolean;
  /** Write progress as percentage 0-100 */
  writePercent: number;
  /** Bytes written so far */
  writtenBytes: number;
  /** Total bytes to write */
  totalBytes: number;
  /** Whether verify stage has completed */
  verifyComplete: boolean;
  /** Error message if stage is "error" */
  error: string | null;
}

/** Initial flash progress state */
export const INITIAL_FLASH_PROGRESS: FlashProgress = {
  stage: "idle",
  eraseComplete: false,
  writePercent: 0,
  writtenBytes: 0,
  totalBytes: 0,
  verifyComplete: false,
  error: null,
} as const;

/** Console log entry for the expandable debug console */
export interface ConsoleEntry {
  timestamp: number;
  text: string;
}
