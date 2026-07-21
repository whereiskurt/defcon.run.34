import { describe, it, expect } from "vitest";
import {
  compareMqttConfig,
  verifyMqttConfig,
  type MqttVerifyExpectation,
  type MqttReadbackDevice,
} from "./verify-config";

const expected: MqttVerifyExpectation = {
  username: "49c83c904836",
  address: "mqtt.defcon.run",
  root: "msh/US",
  enabled: true,
};

const matchingActual = {
  enabled: true,
  address: "mqtt.defcon.run",
  username: "49c83c904836",
  root: "msh/US",
};

/** Minimal fake MeshDevice: replays given module-config packets on request. */
function fakeDevice(opts: {
  packets?: Array<{ payloadVariant: { case: string; value: unknown } }>;
  requestFails?: boolean;
}): MqttReadbackDevice & { unsubscribed: boolean } {
  let handler: ((pkt: never) => void) | null = null;
  const fake = {
    unsubscribed: false,
    events: {
      onModuleConfigPacket: {
        subscribe(cb: (pkt: never) => void) {
          handler = cb;
          return () => {
            fake.unsubscribed = true;
          };
        },
      },
    },
    async getModuleConfig() {
      if (opts.requestFails) throw new Error("request failed");
      queueMicrotask(() => {
        for (const pkt of opts.packets ?? []) {
          handler?.(pkt as never);
        }
      });
      return 0;
    },
  };
  return fake;
}

describe("compareMqttConfig", () => {
  it("returns no mismatches for a matching config", () => {
    expect(compareMqttConfig(expected, matchingActual)).toEqual([]);
  });

  it("reports a username mismatch (the orphaned-cred signature)", () => {
    const mismatches = compareMqttConfig(expected, {
      ...matchingActual,
      username: "ac2f6436ae3d",
    });
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("username");
    expect(mismatches[0]).toContain("ac2f6436ae3d");
  });

  it("reports every differing field", () => {
    const mismatches = compareMqttConfig(expected, {
      enabled: false,
      address: "other.host",
      username: "wrong",
      root: "msh",
    });
    expect(mismatches).toHaveLength(4);
  });
});

describe("verifyMqttConfig", () => {
  it("verifies when the device reports the pushed config", async () => {
    const device = fakeDevice({
      packets: [{ payloadVariant: { case: "mqtt", value: matchingActual } }],
    });
    const result = await verifyMqttConfig(device, expected, 1000);
    expect(result).toEqual({ status: "verified" });
    expect(device.unsubscribed).toBe(true);
  });

  it("reports a mismatch when the device kept stale creds", async () => {
    const device = fakeDevice({
      packets: [
        {
          payloadVariant: {
            case: "mqtt",
            value: { ...matchingActual, username: "ac2f6436ae3d" },
          },
        },
      ],
    });
    const result = await verifyMqttConfig(device, expected, 1000);
    expect(result.status).toBe("mismatch");
    if (result.status === "mismatch") {
      expect(result.mismatches[0]).toContain("ac2f6436ae3d");
    }
  });

  it("ignores non-mqtt module config packets and times out inconclusive", async () => {
    const device = fakeDevice({
      packets: [{ payloadVariant: { case: "serial", value: {} } }],
    });
    const result = await verifyMqttConfig(device, expected, 50);
    expect(result).toEqual({ status: "inconclusive" });
    expect(device.unsubscribed).toBe(true);
  });

  it("is inconclusive when the read-back request fails", async () => {
    const device = fakeDevice({ requestFails: true });
    const result = await verifyMqttConfig(device, expected, 1000);
    expect(result).toEqual({ status: "inconclusive" });
  });
});
