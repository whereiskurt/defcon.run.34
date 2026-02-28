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

export function isEsp32Device(device: DeviceHardware): boolean {
  return ESP32_ARCHITECTURES.includes(device.architecture);
}

export function getFirmwareFilename(
  device: DeviceHardware,
  version: string
): string {
  return `firmware-${device.platformioTarget}-${version}.bin`;
}
