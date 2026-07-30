import { describe, it, expect } from "vitest";

import {
  activeTierCeiling,
  computePoints,
  type ScoringConfig,
  type TimeTier,
} from "../ctf-scoring";

// Fixed clocks for deterministic tier-boundary assertions.
const INSIDE_A = Date.parse("2026-08-07T12:00:00Z"); // within tier A only
const INSIDE_OVERLAP = Date.parse("2026-08-08T12:00:00Z"); // within A and B (overlap)
const OUTSIDE = Date.parse("2026-09-01T00:00:00Z"); // within no tier

const tiers: TimeTier[] = [
  // A: 2026-08-07 .. 2026-08-09 (ceiling 2000)
  { from: "2026-08-07T00:00:00Z", to: "2026-08-09T00:00:00Z", ceiling: 2000 },
  // B: 2026-08-08 .. 2026-08-10 (ceiling 3000) — overlaps A on the 8th
  { from: "2026-08-08T00:00:00Z", to: "2026-08-10T00:00:00Z", ceiling: 3000 },
];

// Base config: pointMax 1000, floor 100, N=5, first-blood +500.
const ctf: ScoringConfig = {
  pointMax: 1000,
  pointFloor: 100,
  maxSolves: 5,
  firstBloodBonus: 500,
  timeTiers: tiers,
};

describe("activeTierCeiling", () => {
  it("returns the in-window ceiling", () => {
    expect(activeTierCeiling(INSIDE_A, tiers)).toBe(2000);
  });

  it("first match wins on overlapping windows", () => {
    // Both A (2000) and B (3000) contain the 8th; A is listed first.
    expect(activeTierCeiling(INSIDE_OVERLAP, tiers)).toBe(2000);
  });

  it("returns null outside all windows", () => {
    expect(activeTierCeiling(OUTSIDE, tiers)).toBeNull();
  });

  it("half-open: `to` is exclusive", () => {
    // Exactly at A.to → not in A; also at B (which contains it) → 3000.
    expect(activeTierCeiling(Date.parse("2026-08-09T00:00:00Z"), tiers)).toBe(3000);
    // Exactly at B.to with only tier A-style single tier → null.
    const single: TimeTier[] = [
      { from: "2026-08-07T00:00:00Z", to: "2026-08-09T00:00:00Z", ceiling: 2000 },
    ];
    expect(activeTierCeiling(Date.parse("2026-08-09T00:00:00Z"), single)).toBeNull();
    // Exactly at from → included.
    expect(activeTierCeiling(Date.parse("2026-08-07T00:00:00Z"), single)).toBe(2000);
  });

  it("does not throw on empty tiers", () => {
    expect(activeTierCeiling(INSIDE_A, [])).toBeNull();
    expect(activeTierCeiling(INSIDE_A, undefined)).toBeNull();
  });

  it("does not throw on garbage-ISO tiers (treated as non-matching)", () => {
    const garbage: TimeTier[] = [
      { from: "not-a-date", to: "also-bad", ceiling: 9999 },
    ];
    expect(() => activeTierCeiling(INSIDE_A, garbage)).not.toThrow();
    expect(activeTierCeiling(INSIDE_A, garbage)).toBeNull();
  });
});

describe("computePoints", () => {
  it("n==1 first blood: sits at ceiling + bonus (no active tier → pointMax)", () => {
    // base = 100 + (1000-100)*1 = 1000; +500 bonus = 1500.
    expect(computePoints(1, ctf, OUTSIDE)).toBe(1500);
  });

  it("n==N lands on pointFloor with no bonus", () => {
    // frac = 1 - (5-1)/(5-1) = 0 → base = 100; no bonus.
    expect(computePoints(5, ctf, OUTSIDE)).toBe(100);
  });

  it("mid-curve declines linearly (n==3)", () => {
    // frac = 1 - (3-1)/(5-1) = 0.5 → base = 100 + 900*0.5 = 550; no bonus.
    expect(computePoints(3, ctf, OUTSIDE)).toBe(550);
  });

  it("n==N+1 → 0 (over the cap)", () => {
    expect(computePoints(6, ctf, OUTSIDE)).toBe(0);
  });

  it("N==1 → full ceiling + bonus (frac forced to 1)", () => {
    const single: ScoringConfig = { ...ctf, maxSolves: 1 };
    // base = 100 + 900*1 = 1000; +500 = 1500.
    expect(computePoints(1, single, OUTSIDE)).toBe(1500);
    // n==2 over the N==1 cap → 0.
    expect(computePoints(2, single, OUTSIDE)).toBe(0);
  });

  it("in-window tier ceiling overrides pointMax", () => {
    // ceiling = 2000 (tier A). n==1: base = 100 + (2000-100)*1 = 2000; +500 = 2500.
    expect(computePoints(1, ctf, INSIDE_A)).toBe(2500);
    // n==5 still lands on floor regardless of ceiling.
    expect(computePoints(5, ctf, INSIDE_A)).toBe(100);
  });

  it("out-of-window falls back to pointMax", () => {
    expect(computePoints(1, ctf, OUTSIDE)).toBe(1500); // uses pointMax 1000, not a tier
  });

  it("rounds the linear base to an integer", () => {
    // pointMax 1000, floor 0, N=3: n==2 → frac 0.5 → base 500 (already int);
    // choose a config that forces rounding.
    const c: ScoringConfig = {
      pointMax: 100,
      pointFloor: 0,
      maxSolves: 4,
      firstBloodBonus: 0,
      timeTiers: [],
    };
    // n==2: frac = 1 - 1/3 = 0.6666..., base = 100*0.6666... = 66.66... → round 67.
    expect(computePoints(2, c, OUTSIDE)).toBe(67);
  });

  it("floorAfterMax: over-cap solvers get the floor, not zero", () => {
    const cfg = { pointMax: 200, pointFloor: 100, maxSolves: 25, firstBloodBonus: 0, floorAfterMax: true };
    expect(computePoints(1, cfg)).toBe(200);
    expect(computePoints(25, cfg)).toBe(100);
    expect(computePoints(26, cfg)).toBe(100);   // floor forever
    expect(computePoints(500, cfg)).toBe(100);
    // default behavior unchanged:
    expect(computePoints(26, { ...cfg, floorAfterMax: undefined })).toBe(0);
  });
});
