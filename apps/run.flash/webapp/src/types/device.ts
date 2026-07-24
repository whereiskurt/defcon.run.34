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

/** UF2 mass-storage bootloader class: no Web-Serial connect step, guided
 *  drag-drop flash, serial reconnect at Configure. nRF52840 (Adafruit
 *  bootloader) and RP2040 (BOOTSEL / RPI-RP2) behave identically at the
 *  wizard level; only the on-device bootloader-entry instructions differ. */
export const UF2_ARCHITECTURES = ["nrf52840", "rp2040"] as const;

export function isEsp32Device(device: DeviceHardware): boolean {
  return ESP32_ARCHITECTURES.includes(device.architecture);
}

export function isUf2Device(device: DeviceHardware): boolean {
  return (UF2_ARCHITECTURES as readonly string[]).includes(device.architecture);
}

/** @deprecated alias — the family value is still "nrf52" for compatibility. */
export const isNrf52Device = isUf2Device;

/** Supported device families. Router in use-flash.ts dispatches by this value.
 *  "nrf52" means the UF2 mass-storage class (nRF52840 AND RP2040). */
export type DeviceFamily = "esp32" | "nrf52";

/**
 * Derive the device family from `device.architecture` — the canonical
 * Meshtastic-supplied source of truth (CONTEXT Decision 3, no schema fork).
 * Throws on unknown architectures (fail-fast, no silent ESP32 fallback that
 * could brick an unknown device).
 */
export function getDeviceFamily(device: DeviceHardware): DeviceFamily {
  if (isEsp32Device(device)) return "esp32";
  if (isUf2Device(device)) return "nrf52";
  throw new Error(`Unsupported device architecture: ${device.architecture}`);
}

export function getFirmwareFilename(
  device: DeviceHardware,
  version: string
): string {
  return `firmware-${device.platformioTarget}-${version}.bin`;
}
