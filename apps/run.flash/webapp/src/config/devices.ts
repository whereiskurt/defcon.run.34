import type { DeviceHardware } from "@/types/device";

/**
 * Known manufacturers extracted from Meshtastic hardware-list.json tags.
 * Used for manufacturer filter chips in the device picker.
 */
export const MANUFACTURERS = [
  "RAK",
  "Heltec",
  "LilyGo",
  "Seeed",
  "Elecrow",
  "M5Stack",
  "B&Q",
  "EByte",
] as const;

/**
 * Devices we've tested and recommend for DCR34.
 * These get a "Recommended" badge and sort to the top.
 * TODO: Update this list once event hardware is finalized
 */
// TODO(v1.4.1 close-out): promote T-1000E (hwModelSlug SEEED_TRACKER_T1000_E) after Phase 25 SC4 hardware verify.
export const RECOMMENDED_SLUGS = new Set([
  "HELTEC_V3",
  "TBEAM",
  "TLORA_V2_1_1P6",
  "RAK4631",
  "STATION_G2",
]);

export function isRecommended(device: DeviceHardware): boolean {
  return RECOMMENDED_SLUGS.has(device.hwModelSlug);
}

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

export function getDeviceImagePath(device: DeviceHardware): string {
  const image = device.images?.[0];
  return image ? `${basePath}/img/devices/${image}` : `${basePath}/img/devices/unknown.svg`;
}

export function getManufacturer(device: DeviceHardware): string {
  return device.tags?.[0] || "Unknown";
}

export function getArchLabel(device: DeviceHardware): string {
  const labels: Record<string, string> = {
    esp32: "ESP32",
    "esp32-s3": "ESP32-S3",
    "esp32-c3": "ESP32-C3",
    "esp32-c6": "ESP32-C6",
  };
  return labels[device.architecture] || device.architecture.toUpperCase();
}

/**
 * Sort: recommended first, then actively supported, then alphabetical.
 */
export function sortDevices(devices: DeviceHardware[]): DeviceHardware[] {
  return [...devices].sort((a, b) => {
    const aRec = isRecommended(a);
    const bRec = isRecommended(b);
    if (aRec && !bRec) return -1;
    if (!aRec && bRec) return 1;

    const aActive = a.activelySupported;
    const bActive = b.activelySupported;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;

    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Deduplicate by hwModel (some devices have multiple platformioTarget variants).
 */
export function deduplicateDevices(
  devices: DeviceHardware[]
): DeviceHardware[] {
  const seen = new Map<number, DeviceHardware>();
  for (const device of devices) {
    if (!seen.has(device.hwModel)) {
      seen.set(device.hwModel, device);
    }
  }
  return [...seen.values()];
}
