import { describe, it, expect } from "vitest";
import { SIM_RABBITS, simRabbit, simRabbitSlug, isSimRabbit, simRabbitIdentity } from "./sim-rabbit-identities";

describe("sim-rabbit-identities", () => {
  it("has 10-12 rabbits, all rabbit_#### names, no fixed/duplicate colors", () => {
    const slugs = Object.keys(SIM_RABBITS);
    expect(slugs.length).toBeGreaterThanOrEqual(10);
    expect(slugs.length).toBeLessThanOrEqual(12);
    for (const s of slugs) {
      expect(SIM_RABBITS[s].displayName).toMatch(/^rabbit_[0-9a-f]{4}$/);
      expect(SIM_RABBITS[s].pinColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // displayNames unique (camouflage: no obvious repeats)
    const names = slugs.map((s) => SIM_RABBITS[s].displayName);
    expect(new Set(names).size).toBe(names.length);
  });
  it("parses slug from longName", () => {
    expect(simRabbitSlug("rabbit-sim-swift-00")).toBe("swift");
    expect(simRabbitSlug("rabbit-sim-dash-07")).toBe("dash");
    expect(simRabbitSlug("elkentaro-09")).toBeNull();
    expect(simRabbitSlug("ghost-condor-00")).toBeNull();
  });
  it("detects sim rabbits by name, isolated from ghosts", () => {
    expect(isSimRabbit("rabbit-sim-swift-00", "R00")).toBe(true);
    expect(isSimRabbit("ghost-condor-00", "GC00")).toBe(false);
    expect(isSimRabbit("elkentaro-09", "J09")).toBe(false);
  });
  it("resolves identity, undefined for unknown slug", () => {
    const first = Object.keys(SIM_RABBITS)[0];
    expect(simRabbit(first)).toEqual(SIM_RABBITS[first]);
    expect(simRabbit("nope")).toBeUndefined();
  });
});

describe("simRabbitIdentity", () => {
  it("resolves individuals via SIM_RABBITS", () => {
    expect(simRabbitIdentity("rabbit-sim-swift-00")).toEqual(SIM_RABBITS.swift);
  });
  it("gives each pack node a distinct deterministic rabbit_#### + color", () => {
    const a = simRabbitIdentity("rabbit-sim-pack-00");
    const b = simRabbitIdentity("rabbit-sim-pack-01");
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect(a!.displayName).toMatch(/^rabbit_[0-9a-f]{4}$/);
    expect(a!.pinColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(a!.displayName).not.toBe(b!.displayName);            // distinct
    expect(simRabbitIdentity("rabbit-sim-pack-00")!.displayName).toBe(a!.displayName); // deterministic
  });
  it("returns null for unknown / non-sim names", () => {
    expect(simRabbitIdentity("rabbit-sim-nope-00")).toBeNull();
    expect(simRabbitIdentity("ghost-condor-00")).toBeNull();
  });
});
