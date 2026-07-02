export interface DeviceHardware {
  hwModel: number;
  hwModelSlug: string;
  platformioTarget: string;
  architecture: string;
  activelySupported: boolean;
  displayName: string;
  supportLevel?: number;
  tags?: string[];
  images?: string[];
  partitionScheme?: string;
  requiresDfu?: boolean;
  hasMui?: boolean;
  hasInkHud?: boolean;
}

export const ESP32_ARCHITECTURES = [
  "esp32",
  "esp32-s3",
  "esp32-c3",
  "esp32-c6",
];

export const NRF52_ARCHITECTURES = ["nrf52840"] as const;

export function isEsp32Device(device: DeviceHardware): boolean {
  return ESP32_ARCHITECTURES.includes(device.architecture);
}

export function isNrf52Device(device: DeviceHardware): boolean {
  return (NRF52_ARCHITECTURES as readonly string[]).includes(
    device.architecture
  );
}

/** Supported device families. Router in use-flash.ts dispatches by this value. */
export type DeviceFamily = "esp32" | "nrf52";

/**
 * Derive the device family from `device.architecture` — the canonical
 * Meshtastic-supplied source of truth (CONTEXT Decision 3, no schema fork).
 * Throws on unknown architectures (fail-fast, no silent ESP32 fallback that
 * could brick an unknown device).
 */
export function getDeviceFamily(device: DeviceHardware): DeviceFamily {
  if (isEsp32Device(device)) return "esp32";
  if (isNrf52Device(device)) return "nrf52";
  throw new Error(`Unsupported device architecture: ${device.architecture}`);
}

export function getFirmwareFilename(
  device: DeviceHardware,
  version: string
): string {
  return `firmware-${device.platformioTarget}-${version}.bin`;
}
