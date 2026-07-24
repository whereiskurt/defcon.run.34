import type { DeviceHardware } from "@/types/device";
import firmwareManifest from "@/../public/data/firmware-manifest.json";

// Injected at build time from Dockerfile.webapp builder ARG (production) or scripts/download-firmware.sh -> .env.local (local dev).
export const FIRMWARE_VERSION = process.env.NEXT_PUBLIC_FIRMWARE_VERSION ?? "";

/** One selectable firmware version from public/data/firmware-manifest.json
 *  (tracked snapshot, overwritten by Dockerfile Stage 1 at build time). */
export interface FirmwareVersionEntry {
  slot: string;
  version: string;
  label: string;
  default: boolean;
  experimental: boolean;
}

export const FIRMWARE_VERSIONS: FirmwareVersionEntry[] =
  firmwareManifest.versions as FirmwareVersionEntry[];

/** The preselected version — falls back to the build-time env single-version
 *  value so a malformed manifest can never blank the flasher. */
export const DEFAULT_FIRMWARE_VERSION: string =
  FIRMWARE_VERSIONS.find((v) => v.default)?.version ?? FIRMWARE_VERSION;

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
  return `firmware-${device.platformioTarget}-${version}.factory.bin`;
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
 * Meshtastic UF2 filename convention: firmware-{platformioTarget}-{version}.uf2.
 * Parallel to getFactoryFilename (esp32 .factory.bin).
 */
export function getUf2Filename(
  device: DeviceHardware,
  version: string = FIRMWARE_VERSION
): string {
  return `firmware-${device.platformioTarget}-${version}.uf2`;
}

/**
 * Load a UF2 firmware artifact as raw bytes.
 *
 * Unlike loadFirmware (which returns a binary string because esptool-js
 * consumes String data), loadUf2 returns a Uint8Array — the Web USB DFU
 * write path in web-dfu.ts consumes bytes directly with no
 * binary-string dance.
 *
 * @throws Error if the file is not present under /firmware/ (Dockerfile
 *   Stage 1 didn't extract it, or the device's target isn't in the
 *   nrf52840 firmware zip).
 */
export async function loadUf2(
  device: DeviceHardware,
  version: string = FIRMWARE_VERSION
): Promise<{ data: Uint8Array; size: number; filename: string }> {
  const filename = getUf2Filename(device, version);
  const url = `${FIRMWARE_BASE_PATH}/${filename}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `UF2 firmware not found for ${device.displayName}. ` +
        `Expected file: ${filename} (HTTP ${response.status}).`
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
