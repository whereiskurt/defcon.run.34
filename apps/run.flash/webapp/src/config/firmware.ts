import type { DeviceHardware } from "@/types/device";

/**
 * DCR34-pinned Meshtastic firmware version.
 * TODO: Update when event firmware version is finalized.
 * This is a placeholder version -- the code works with any Meshtastic release
 * since the naming convention is stable.
 */
export const FIRMWARE_VERSION = "2.6.11.60ec05e";

/** Base path for firmware binaries.
 * In production, firmware is served from S3 via CloudFront using the asset prefix.
 * In development, served locally from public/firmware/.
 */
export const FIRMWARE_BASE_PATH = process.env.NEXT_PUBLIC_ASSET_PREFIX
  ? `${process.env.NEXT_PUBLIC_ASSET_PREFIX}/firmware`
  : "/firmware";

/**
 * Construct the firmware binary filename for a device.
 * Uses the standard Meshtastic naming: firmware-{platformioTarget}-{version}.bin
 */
export function getFactoryFilename(
  device: DeviceHardware,
  version: string = FIRMWARE_VERSION
): string {
  return `firmware-${device.platformioTarget}-${version}.bin`;
}

/**
 * Convert a Uint8Array to a binary string.
 * esptool-js expects firmware data as binary strings, not Uint8Array.
 */
function uint8ToBinaryString(data: Uint8Array): string {
  // Process in chunks to avoid stack overflow for large firmware files
  const CHUNK_SIZE = 8192;
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
    parts.push(String.fromCharCode(...chunk));
  }
  return parts.join("");
}

/**
 * Load firmware binary from the app's static files as a binary string.
 * Firmware is served from public/firmware/ during development and
 * baked into the Docker image in Phase 4.
 *
 * Returns a binary string because esptool-js writeFlash expects string data,
 * not Uint8Array. The size field reflects the original byte count.
 *
 * @throws Error if firmware file is not found (HTTP 404)
 */
export async function loadFirmware(
  device: DeviceHardware,
  version: string = FIRMWARE_VERSION
): Promise<{ data: string; size: number; filename: string }> {
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
  const bytes = new Uint8Array(buffer);
  const data = uint8ToBinaryString(bytes);
  return { data, size: bytes.length, filename };
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
