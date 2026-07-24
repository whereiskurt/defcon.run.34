import { describe, it, expect } from "vitest";
import {
  getFactoryFilename,
  getUf2Filename,
  DEFAULT_FIRMWARE_VERSION,
} from "./firmware";
import type { DeviceHardware } from "@/types/device";

const device: DeviceHardware = {
  hwModel: 9,
  hwModelSlug: "TBEAM",
  platformioTarget: "tbeam",
  architecture: "esp32",
  activelySupported: true,
  displayName: "T-Beam",
};

describe("firmware filename helpers", () => {
  it("uses an explicitly passed version", () => {
    expect(getFactoryFilename(device, "2.8.0.ef1aedd")).toBe(
      "firmware-tbeam-2.8.0.ef1aedd.factory.bin"
    );
    expect(getUf2Filename(device, "2.8.0.ef1aedd")).toBe(
      "firmware-tbeam-2.8.0.ef1aedd.uf2"
    );
  });

  it("defaults to DEFAULT_FIRMWARE_VERSION (manifest default), not the env var", () => {
    expect(getFactoryFilename(device)).toBe(
      `firmware-tbeam-${DEFAULT_FIRMWARE_VERSION}.factory.bin`
    );
  });
});
