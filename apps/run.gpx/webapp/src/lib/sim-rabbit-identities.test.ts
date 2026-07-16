import { describe, it, expect } from "vitest";
import { SIM_RABBITS, simRabbit, simRabbitSlug, isSimRabbit } from "./sim-rabbit-identities";

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
