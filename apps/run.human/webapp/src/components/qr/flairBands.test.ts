import { describe, it, expect } from "vitest";

import { flairParams, MILESTONES } from "./flairBands";
import type { BandTier } from "@/lib/social-rank";

const TIERS: BandTier[] = [
  "none",
  "entered",
  "top50",
  "top25",
  "top10",
  "top5",
  "leader",
];

describe("flairParams", () => {
  it("escalates monotonically across bands", () => {
    for (let i = 1; i < TIERS.length; i++) {
      const prev = flairParams(TIERS[i - 1]);
      const cur = flairParams(TIERS[i]);
      expect(cur.reactorOpacity).toBeGreaterThanOrEqual(prev.reactorOpacity);
      expect(cur.haloOpacity).toBeGreaterThanOrEqual(prev.haloOpacity);
      expect(cur.ringFill).toBeGreaterThanOrEqual(prev.ringFill);
      expect(cur.ticksOn).toBeGreaterThanOrEqual(prev.ticksOn);
      expect(cur.badgeGlow).toBeGreaterThanOrEqual(prev.badgeGlow);
      expect(cur.spinSecs).toBeLessThanOrEqual(prev.spinSecs);
    }
  });

  it("early gratification: visible flair from TOP 50%", () => {
    expect(flairParams("top50").reactorOpacity).toBeGreaterThan(0);
    expect(flairParams("top50").scanHeight).toBeGreaterThan(0);
    expect(flairParams("top50").badgeGlow).toBeGreaterThan(0);
  });

  it("scanline never exceeds the EC-H safety cap", () => {
    for (const tier of TIERS) {
      expect(flairParams(tier).scanHeight).toBeLessThanOrEqual(18);
    }
  });

  it("only LEADER is gold, and it has no teaser", () => {
    for (const tier of TIERS) {
      expect(flairParams(tier).gold).toBe(tier === "leader");
    }
    expect(flairParams("leader").teaser).toBe("");
    expect(flairParams("top5").teaser).toContain("GOLD");
  });

  it("every non-leader band advertises what comes next", () => {
    for (const tier of TIERS.filter((t) => t !== "leader")) {
      expect(flairParams(tier).teaser.length).toBeGreaterThan(0);
    }
  });
});

describe("MILESTONES", () => {
  it("thresholds are 1/15/30/60/100 ascending", () => {
    expect(MILESTONES.map((m) => m.threshold)).toEqual([1, 15, 30, 60, 100]);
  });
});
