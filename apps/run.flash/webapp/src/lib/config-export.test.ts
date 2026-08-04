import { describe, it, expect } from "vitest";
import { toReadableText, toJson, toCliScript, exportConfig } from "./config-export";
import type { DeviceConfigPayload } from "@/types/config";

const payload: DeviceConfigPayload = {
  mqtt: { server: "mqtt.defcon.run", port: 4433, username: "abc123", password: "s3cret", tls: true, root: "msh/US" },
  channels: [
    { name: "dc.run", psk: "Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=", role: "PRIMARY", positionPrecision: 32, uplinkEnabled: true, downlinkEnabled: true },
    { name: "DEFCONnect", psk: "OEu8wB3AItGBvza4YSHh+5a3LlW/dCJ+nWr7SNZMsaE=", role: "SECONDARY", positionPrecision: 14, uplinkEnabled: false, downlinkEnabled: false },
    { name: "HackerComms", psk: "6IzsaoVhx1ETWeWuu0dUWMLqItvYJLbRzwgTAKCfvtY=", role: "SECONDARY", positionPrecision: 0, uplinkEnabled: false, downlinkEnabled: false },
    { name: "NodeChat", psk: "TiIdi8MJG+IRnIkS8iUZXRU+MHuGtuzEasOWXp4QndU=", role: "SECONDARY", positionPrecision: 0, uplinkEnabled: false, downlinkEnabled: false },
    { name: "LongFast", psk: "AQ==", role: "SECONDARY", positionPrecision: 0, uplinkEnabled: false, downlinkEnabled: false },
  ],
  identity: { longName: "rabbit_abc1", shortName: "RABB" },
  radio: { region: "US", modemPreset: "SHORT_TURBO", channelNum: 31, hopLimit: 3 },
  device: { rebroadcastMode: "CORE_PORTNUMS_ONLY" },
  ringtone: "ax:d=4,o=5,b=100:8g,8g",
  position: { broadcastSecs: 60, smartEnabled: true },
  mapReport: { enabled: true, positionPrecision: 32, publishIntervalSecs: 3600 },
};

describe("toReadableText", () => {
  it("contains every value a manual setup needs, grouped with a privacy header", () => {
    const txt = toReadableText(payload);
    expect(txt).toMatch(/keep this file private/i);
    for (const v of ["mqtt.defcon.run", "4433", "abc123", "s3cret", "msh/US",
      "dc.run", "Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=", "LongFast", "AQ==",
      "DEFCONnect", "OEu8wB3AItGBvza4YSHh+5a3LlW/dCJ+nWr7SNZMsaE=",
      "HackerComms", "6IzsaoVhx1ETWeWuu0dUWMLqItvYJLbRzwgTAKCfvtY=",
      "NodeChat", "TiIdi8MJG+IRnIkS8iUZXRU+MHuGtuzEasOWXp4QndU=",
      "Rebroadcast mode: CORE_PORTNUMS_ONLY",
      "rabbit_abc1", "RABB", "US", "SHORT_TURBO", "Frequency slot: 31", "ax:d=4,o=5,b=100:8g,8g"]) {
      expect(txt).toContain(v);
    }
    expect(txt).toMatch(/TLS:\s*on/i);
  });

  it("shows MQTT uplink/downlink on for dc.run and off for every other channel", () => {
    const blocks = toReadableText(payload).split(/ {2}Channel \d+ \(/).slice(1);
    expect(blocks).toHaveLength(5);
    expect(blocks[0]).toContain("MQTT uplink: on   MQTT downlink: on");
    for (const b of blocks.slice(1)) {
      expect(b).toContain("MQTT uplink: off   MQTT downlink: off");
    }
  });
});

describe("toJson", () => {
  it("round-trips the payload verbatim", () => {
    expect(JSON.parse(toJson(payload))).toEqual(payload);
  });
});

describe("toCliScript", () => {
  it("emits meshtastic CLI commands incl. base64 PSKs and quoted ringtone", () => {
    const sh = toCliScript(payload);
    expect(sh).toContain("--set mqtt.address 'mqtt.defcon.run:4433'");
    expect(sh).toContain("--set mqtt.username 'abc123'");
    expect(sh).toContain("--set mqtt.tls_enabled true");
    expect(sh).toContain("--ch-set psk 'base64:Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=' --ch-index 0");
    expect(sh).toContain("--ch-set psk 'base64:AQ==' --ch-index 4");
    expect(sh).toContain("--set lora.region US");
    expect(sh).toContain("--set lora.modem_preset SHORT_TURBO --set lora.channel_num 31");
    expect(sh).toContain("--set device.rebroadcast_mode CORE_PORTNUMS_ONLY");
    expect(sh).toContain("--ch-set psk 'base64:OEu8wB3AItGBvza4YSHh+5a3LlW/dCJ+nWr7SNZMsaE=' --ch-index 1");
    expect(sh).toContain("--ch-add 'NodeChat'");
    expect(sh).toContain("--set-owner 'rabbit_abc1'");
    expect(sh).toContain("--set-ringtone 'ax:d=4,o=5,b=100:8g,8g'");
    expect(sh).toMatch(/keep this file private/i);
  });

  it("sets uplink/downlink true only on channel 0", () => {
    const sh = toCliScript(payload);
    expect(sh).toContain("--ch-set uplink_enabled true --ch-set downlink_enabled true --ch-index 0");
    for (const i of [1, 2, 3, 4]) {
      expect(sh).toContain(
        `--ch-set uplink_enabled false --ch-set downlink_enabled false --ch-index ${i}`
      );
    }
  });

  it("single-quote-escapes embedded quotes safely", () => {
    const p = { ...payload, identity: { ...payload.identity, longName: "it's_me" } };
    expect(toCliScript(p)).toContain("--set-owner 'it'\\''s_me'");
  });
});

describe("exportConfig", () => {
  it("maps format to filename and mime", () => {
    expect(exportConfig(payload, "txt").filename).toBe("dcrun-radio-config.txt");
    expect(exportConfig(payload, "json").filename).toBe("dcrun-radio-config.json");
    expect(exportConfig(payload, "sh").filename).toBe("dcrun-radio-config.sh");
    expect(exportConfig(payload, "json").mime).toBe("application/json");
  });
});
