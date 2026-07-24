import { describe, it, expect } from "vitest";
import { getDeviceFamily, type DeviceHardware } from "./device";

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
