import { describe, it, expect } from "vitest";
import {
  getDeviceFamily,
  isNativeUsbDevice,
  type DeviceHardware,
} from "./device";

function dev(architecture: string): DeviceHardware {
  return {
    hwModel: 1,
    hwModelSlug: "X",
    platformioTarget: "x",
    architecture,
    activelySupported: true,
    displayName: "X",
  };
}

describe("getDeviceFamily", () => {
  it("routes esp32 family to esp32", () => {
    expect(getDeviceFamily(dev("esp32"))).toBe("esp32");
    expect(getDeviceFamily(dev("esp32-s3"))).toBe("esp32");
  });

  it("routes nrf52840 to the uf2-class nrf52 flow", () => {
    expect(getDeviceFamily(dev("nrf52840"))).toBe("nrf52");
  });

  it("routes rp2040 to the uf2-class nrf52 flow", () => {
    expect(getDeviceFamily(dev("rp2040"))).toBe("nrf52");
  });

  it("throws on unsupported architectures", () => {
    expect(() => getDeviceFamily(dev("portduino"))).toThrow(/Unsupported/);
  });
});

describe("isNativeUsbDevice", () => {
  it("classic bridge-chip esp32 (T-Beam) is NOT native USB", () => {
    expect(isNativeUsbDevice(dev("esp32"))).toBe(false);
  });

  it("esp32-s3 (T-Beam 1W), c3, c6 are native USB", () => {
    expect(isNativeUsbDevice(dev("esp32-s3"))).toBe(true);
    expect(isNativeUsbDevice(dev("esp32-c3"))).toBe(true);
    expect(isNativeUsbDevice(dev("esp32-c6"))).toBe(true);
  });

  it("uf2-class architectures are NOT native-USB esp32", () => {
    expect(isNativeUsbDevice(dev("nrf52840"))).toBe(false);
    expect(isNativeUsbDevice(dev("rp2040"))).toBe(false);
  });
});
