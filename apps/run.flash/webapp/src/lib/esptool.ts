/**
 * esptool.js wrapper for Web Serial connection and chip detection.
 * This module contains all direct esptool.js API interaction.
 * UI components should use the useSerial and useFlash hooks instead.
 */
import { ESPLoader, Transport } from "esptool-js";
import type { IEspLoaderTerminal } from "esptool-js";
import type { ChipInfo } from "@/types/serial";

/** Default baud rate for initial serial connection */
export const DEFAULT_BAUDRATE = 115200;

/**
 * Create an IEspLoaderTerminal that captures raw esptool.js output.
 * The terminal is used by ESPLoader for debug/status output.
 * appendLog receives each line for display in the expandable console.
 */
export function createTerminalLogger(
  appendLog: (text: string) => void
): IEspLoaderTerminal {
  return {
    clean: () => {},
    writeLine: (data: string) => appendLog(data + "\n"),
    write: (data: string) => appendLog(data),
  };
}

/**
 * Connect to an ESP32 device over Web Serial using esptool.js.
 *
 * IMPORTANT: The `port` parameter MUST come from navigator.serial.requestPort()
 * called inside a user gesture handler (click event). This function does NOT
 * call requestPort() itself -- that must happen in the hook/component.
 *
 * @param port - SerialPort from navigator.serial.requestPort()
 * @param terminal - IEspLoaderTerminal for raw output capture
 * @returns ESPLoader instance, Transport instance, and detected chip info
 * @throws Error on connection failure (timeout, port busy, sync failure)
 */
export async function connectToDevice(
  port: SerialPort,
  terminal: IEspLoaderTerminal
): Promise<{
  espLoader: ESPLoader;
  transport: Transport;
  chipInfo: ChipInfo;
}> {
  // Create transport wrapping the serial port
  const transport = new Transport(port);

  // Create ESPLoader with the transport
  // romBaudrate is the initial baud rate for ROM bootloader communication
  // baudrate is the target baud rate after stub upload (can be higher)
  const espLoader = new ESPLoader({
    transport,
    baudrate: DEFAULT_BAUDRATE,
    romBaudrate: DEFAULT_BAUDRATE,
    terminal,
  });

  try {
    // Connect and detect chip type
    // main() syncs with the bootloader and returns the chip type ROM identifier
    // e.g., "esp32s3" (lowercase, no dash)
    await espLoader.main();

    // Get human-readable chip info
    const chipName = espLoader.chip.CHIP_NAME; // e.g., "ESP32-S3"
    const chipDescription = await espLoader.chip.getChipDescription(espLoader);

    return {
      espLoader,
      transport,
      chipInfo: { chipName, chipDescription },
    };
  } catch (err) {
    // Clean up transport on failure
    try {
      await transport.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }
    throw err;
  }
}

/**
 * Validate that the detected chip matches the selected device's architecture.
 * This prevents flashing wrong firmware which could brick the device.
 *
 * @param detectedChipName - e.g., "ESP32-S3" from espLoader.chip.CHIP_NAME
 * @param selectedArchitecture - e.g., "esp32-s3" from DeviceHardware.architecture
 * @returns true if chip matches device
 */
export function validateChipMatch(
  detectedChipName: string,
  selectedArchitecture: string
): boolean {
  // Normalize: esptool.js uses "ESP32-S3", our device type uses "esp32-s3"
  const normalized = detectedChipName.toLowerCase().replace(/\s+/g, "-");
  return normalized === selectedArchitecture;
}

/**
 * Get a human-friendly error message for common serial connection errors.
 */
export function getConnectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("No port selected")) {
    return "No device selected. Click Connect and choose your device from the browser prompt.";
  }
  if (
    message.includes("Failed to open") ||
    message.includes("already in use") ||
    message.includes("NetworkError")
  ) {
    return "Could not open serial port. Close any other apps using this port (Arduino IDE, PlatformIO, serial monitors) and try again.";
  }
  if (message.includes("timeout") || message.includes("Timeout")) {
    return "Connection timed out. Your device may not be in bootloader mode. Try holding the BOOT button while pressing RESET.";
  }
  if (message.includes("NotFoundError")) {
    return "No compatible device found. Make sure your ESP32 is connected via USB and drivers are installed.";
  }

  return `Connection failed: ${message}`;
}
