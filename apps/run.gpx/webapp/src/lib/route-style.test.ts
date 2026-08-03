import { describe, it, expect } from "vitest";

/**
 * Tests for the shared route line styling.
 *
 * Same arrangement as checkin-cluster.test.ts / z-bands.test.ts: the module lives in
 * gpx-studio but the studio has no test runner, so it is exercised from the webapp's
 * vitest by relative path.
 */
import {
  coreWidth,
  glowWidth,
  coreWidthAt,
  ROUTE_BLUR,
  CORE_OPACITY,
  GLOW_OPACITY,
  NOMINAL_WEIGHT,
} from "../../../gpx-studio/website/src/lib/components/map/route-style";

describe("route-style", () => {
  it("interpolates the core 3px at z12 to 8px at z16", () => {
    expect(coreWidthAt(12)).toBeCloseTo(3);
    expect(coreWidthAt(16)).toBeCloseTo(8);
  });

  it("thins the line at the zoom the bug was reported at (z14.55)", () => {
    // 3 + (8-3) * (2.55/4) = 6.1875
    expect(coreWidthAt(14.55)).toBeCloseTo(6.1875, 4);
  });

  it("clamps outside the ramp instead of extrapolating", () => {
    expect(coreWidthAt(8)).toBeCloseTo(3);
    expect(coreWidthAt(22)).toBeCloseTo(8);
  });

  it("is thinner at every zoom than the old flat 10px core", () => {
    for (const z of [10, 12, 13, 14.55, 16, 20]) {
      expect(coreWidthAt(z)).toBeLessThan(10);
    }
  });

  it("scales with the CMS mapWeight around a nominal 4", () => {
    expect(NOMINAL_WEIGHT).toBe(4);
    expect(coreWidthAt(16, 4)).toBeCloseTo(8);
    expect(coreWidthAt(16, 8)).toBeCloseTo(16);
    expect(coreWidthAt(16, 2)).toBeCloseTo(4);
  });

  it("emits a mapbox linear-zoom interpolate expression agreeing with coreWidthAt", () => {
    const e = coreWidth() as unknown[];
    expect(e[0]).toBe("interpolate");
    expect(e[1]).toEqual(["linear"]);
    expect(e[2]).toEqual(["zoom"]);
    expect(e[3]).toBe(12);
    expect(e[4]).toBeCloseTo(coreWidthAt(12));
    expect(e[5]).toBe(16);
    expect(e[6]).toBeCloseTo(coreWidthAt(16));
  });

  it("carries mapWeight into the expression too", () => {
    const e = coreWidth(8) as number[];
    expect(e[4]).toBeCloseTo(coreWidthAt(12, 8));
    expect(e[6]).toBeCloseTo(coreWidthAt(16, 8));
  });

  it("makes the glow 3.6x the core at both stops", () => {
    const c = coreWidth() as number[];
    const g = glowWidth() as number[];
    expect(g[4] / c[4]).toBeCloseTo(3.6);
    expect(g[6] / c[6]).toBeCloseTo(3.6);
  });

  it("keeps the glow wider than the core for any weight", () => {
    for (const w of [1, 4, 10]) {
      const c = coreWidth(w) as number[];
      const g = glowWidth(w) as number[];
      expect(g[4]).toBeGreaterThan(c[4]);
      expect(g[6]).toBeGreaterThan(c[6]);
    }
  });

  it("is softer and less shouty than the shipped values (blur 6, core .95, glow .35)", () => {
    expect(ROUTE_BLUR).toBeGreaterThan(6);
    expect(CORE_OPACITY).toBeLessThan(0.95);
    expect(GLOW_OPACITY).toBeGreaterThan(0.35);
  });
});
