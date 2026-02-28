import type { DeviceHardware } from "@/types/device";

/**
 * DCR34-pinned Meshtastic firmware version.
 * TODO: Update when event firmware version is finalized.
 * This is a placeholder version -- the code works with any Meshtastic release
 * since the naming convention is stable.
 */
export const FIRMWARE_VERSION = "2.6.6.0a23203";

/** Base path for firmware binaries served by the app */
export const FIRMWARE_BASE_PATH = "/firmware";

/**
 * Construct the factory binary filename for a device.
 * Factory binary includes bootloader + partition table + application,
 * flashable at address 0x0 as a single file.
 */
export function getFactoryFilename(
  device: DeviceHardware,
  version: string = FIRMWARE_VERSION
): string {
  return `firmware-${device.platformioTarget}-${version}.factory.bin`;
}

/**
 * Load firmware binary from the app's static files as Uint8Array.
 * Firmware is served from public/firmware/ during development and
 * baked into the Docker image in Phase 4.
 *
 * @throws Error if firmware file is not found (HTTP 404)
 */
export async function loadFirmware(
  device: DeviceHardware,
  version: string = FIRMWARE_VERSION
): Promise<{ data: Uint8Array; size: number; filename: string }> {
  const filename = getFactoryFilename(device, version);
  const url = `${FIRMWARE_BASE_PATH}/${filename}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Firmware not found for ${device.displayName}. ` +
        `Expected file: ${filename} (HTTP ${response.status}). ` +
        `Run scripts/download-firmware.sh to download firmware files.`
    );
  }

  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  return { data, size: data.length, filename };
}

/**
 * Format bytes as human-readable string.
 * e.g., 393216 -> "384KB", 1048576 -> "1.0MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
