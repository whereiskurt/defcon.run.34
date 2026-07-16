import { describe, it, expect } from "vitest";
import {
  isGhost, hasValidPosition, lastSeen, ghostSlug, coord, hexToNodeNum,
  ghostFeatureCollection, rabbitFeatureCollection,
  simRabbitFeatureCollection, radioFields, type NodeDb,
} from "./mesh-nodes";

const ghost = {
  from: 2770627464, fromStr: "!a5246b88", longName: "ghost-condor-00",
  shortName: "GC00", latitude: 360817149, longitude: -1151727650,
  lastMapReport: 1754357652, batteryLevel: 71, privkey: "0xSECRET",
  pubkey: "0xSECRET", seenBy: { "msh/US/2/e/dc.run": 1754357652 },
};
const real = {
  from: 2503245760, fromStr: "!95347fc0", longName: "elkentaro-09",
  shortName: "J09", latitude: 356303231, longitude: 1397374428,
  lastMapReport: 1754357805, seenBy: { "msh/US/2/e/dc.run": 1754357805 },
};
const noPos = { longName: "ghost-zero", latitude: 0, longitude: 0 };

describe("mesh-nodes", () => {
  it("detects ghosts by longName", () => {
    expect(isGhost(ghost)).toBe(true);
    expect(isGhost(real)).toBe(false);
    expect(isGhost({ shortName: "operative-1" } as any)).toBe(true);
  });
  it("gates invalid positions", () => {
    expect(hasValidPosition(real)).toBe(true);
    expect(hasValidPosition(noPos as any)).toBe(false);
    expect(hasValidPosition({ latitude: 1, longitude: 1 } as any)).toBe(false); // no name
  });
  it("converts int-degrees to [lon,lat]", () => {
    expect(coord(real)).toEqual([139.7374428, 35.6303231]);
  });
  it("derives ghost slug", () => {
    expect(ghostSlug("ghost-condor-00")).toBe("condor");
    expect(ghostSlug("operative_mudge")).toBe("mudge");
  });
  it("converts hex node id to numeric uint32 (no zero-pad assumption)", () => {
    expect(hexToNodeNum("!95347fc0")).toBe(2503245760);
    expect(hexToNodeNum("!ff")).toBe(255);
  });
  it("picks lastSeen from lastMapReport or max(seenBy)", () => {
    expect(lastSeen(real)).toBe(1754357805);
    expect(lastSeen({ seenBy: { a: 5, b: 9 } } as any)).toBe(9);
  });
  it("builds a ghost FeatureCollection and strips secrets + real nodes", () => {
    const db: NodeDb = { "2770627464": ghost as any, "2503245760": real as any, "9": noPos as any };
    const fc = ghostFeatureCollection(db);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-115.172765, 36.0817149] });
    expect(f.properties!.slug).toBe("condor");
    expect(f.properties!.who).toBe("Kevin Mitnick");
    expect(JSON.stringify(f)).not.toMatch(/SECRET|privkey|pubkey/);
  });
  it("intersects rabbits by numeric node id and emits identity", () => {
    const db: NodeDb = { "2503245760": real as any, "2770627464": ghost as any };
    const fc = rabbitFeatureCollection(db, [
      { nodeNum: 2503245760, displayName: "rabbit_9f2a", userType: "rabbit", pinIcon: "star", pinColor: "#00d4aa" },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties!.displayName).toBe("rabbit_9f2a");
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [139.7374428, 35.6303231] });
  });
});

const simNode = {
  from: 111, fromStr: "!0000006f", longName: "rabbit-sim-swift-00", shortName: "R00",
  latitude: 360817149, longitude: -1151727650, lastMapReport: 1754357652,
  hwModel: "TRACKER_T1000_E", role: "CLIENT_MUTE", region: "US", modemPreset: "MEDIUM_FAST",
  fwVersion: "2.7.2", hasDefaultCh: true, batteryLevel: 71,
  privkey: "0xSECRET", pubkey: "0xSECRET",
};
const realRadio = {
  from: 2503245760, fromStr: "!95347fc0", longName: "elkentaro-09", shortName: "J09",
  latitude: 356303231, longitude: 1397374428, lastMapReport: 1754357805,
  hwModel: "HELTEC_V3", role: "CLIENT", region: "US", modemPreset: "LONG_FAST",
  fwVersion: "2.6.0", hasDefaultCh: false, batteryLevel: 42,
};

describe("radioFields", () => {
  it("extracts the allowlisted radio config, no keys", () => {
    const r = radioFields(simNode as any);
    expect(r).toEqual({
      hwModel: "TRACKER_T1000_E", role: "CLIENT_MUTE", region: "US",
      modemPreset: "MEDIUM_FAST", fwVersion: "2.7.2", channel: "dc.run", battery: 71,
    });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
  it("defaults missing fields", () => {
    expect(radioFields({ longName: "x" } as any)).toEqual({
      hwModel: "", role: "", region: "", modemPreset: "", fwVersion: "", channel: "custom", battery: -1,
    });
  });
});

describe("simRabbitFeatureCollection", () => {
  it("emits known sim rabbits as rabbit features with radio fields, keys stripped", () => {
    const fc = simRabbitFeatureCollection({ "111": simNode } as any);
    expect(fc.features).toHaveLength(1);
    const p = fc.features[0].properties as any;
    expect(p.displayName).toBe("rabbit_4a1c"); // SIM_RABBITS.swift
    expect(p.pinColor).toBe("#e6007a");
    expect(p.userType).toBe("rabbit");
    expect(p.hwModel).toBe("TRACKER_T1000_E");
    expect(p.battery).toBe(71);
    expect(JSON.stringify(fc)).not.toContain("SECRET");
  });
  it("skips ghosts, real nodes, unknown slugs, and no-position sims", () => {
    const db = {
      "1": { longName: "ghost-condor-00", latitude: 1, longitude: 1 },
      "2": { longName: "elkentaro-09", latitude: 356303231, longitude: 1397374428 },
      "3": { longName: "rabbit-sim-unknownslug-00", latitude: 360817149, longitude: -1151727650 },
      "4": { longName: "rabbit-sim-swift-01", latitude: 0, longitude: 0 },
    };
    expect(simRabbitFeatureCollection(db as any).features).toHaveLength(0);
  });
});

describe("rabbitFeatureCollection radio parity", () => {
  it("real rabbits emit the same radio field set as sims", () => {
    const fc = rabbitFeatureCollection(
      { "2503245760": realRadio } as any,
      [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinColor: "#00d4aa" }]
    );
    const p = fc.features[0].properties as any;
    expect(p.hwModel).toBe("HELTEC_V3");
    expect(p.channel).toBe("custom"); // hasDefaultCh false
    expect(p.battery).toBe(42);
    expect(p.pinColor).toBe("#00d4aa");
  });
});

describe("rabbitFeatureCollection pinColor camouflage parity", () => {
  it("resolves an empty pinColor to the default so it's never emitted as \"\"", () => {
    const fc = rabbitFeatureCollection(
      { "2503245760": realRadio } as any,
      [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinColor: "" }]
    );
    expect(fc.features[0].properties!.pinColor).toBe("#e6007a");
  });
  it("resolves a missing pinColor to the default so it's never emitted as \"\"", () => {
    const fc = rabbitFeatureCollection(
      { "2503245760": realRadio } as any,
      [{ nodeNum: 2503245760, displayName: "rabbit_9f2a" }]
    );
    expect(fc.features[0].properties!.pinColor).toBe("#e6007a");
  });
});
