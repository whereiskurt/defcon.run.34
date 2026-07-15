import { describe, it, expect } from "vitest";
import {
  isGhost, hasValidPosition, lastSeen, ghostSlug, coord, hexToNodeNum,
  ghostFeatureCollection, rabbitFeatureCollection, type NodeDb,
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
      { nodeNum: 2503245760, displayName: "rabbit_9f2a", userType: "rabbit", pinIcon: "star", pinColor: "#00d4aa", hash: "abc" },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties!.displayName).toBe("rabbit_9f2a");
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [139.7374428, 35.6303231] });
  });
});
