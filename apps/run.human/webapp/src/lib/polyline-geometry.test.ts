import { describe, it, expect } from "vitest";
import {
  computeBounds,
  latLngToTile,
  calculateZoomLevel,
  centerTile,
  type LatLng,
  type Bounds,
} from "./polyline-geometry";

/**
 * Pure-core unit tests for the PolylineRenderer map geometry (LDBR-09, Phase 52).
 * No DOM, no canvas, no fetch — every invariant is proven over plain fixtures.
 *
 * The math is a verbatim port of DC33's PolylineRenderer (latLngToTile floored
 * slippy-map formula; calculateZoomLevel 15→10 with a fallback of 12; center =
 * bounds midpoint). Extracting it here keeps the renderer's map math testable
 * without a canvas. Mirrors the leaderboard-data.test.ts convention (describe/it/
 * expect, plain fixtures, no mocks).
 */

// A tight two-point Vegas-area route (start/end a few hundred metres apart).
const vegasRoute: LatLng[] = [
  { lat: 36.1699, lng: -115.1398 },
  { lat: 36.1712, lng: -115.1375 },
];

// A single-point degenerate "route" (min == max on both axes).
const singlePoint: LatLng[] = [{ lat: 36.1699, lng: -115.1398 }];

describe("computeBounds", () => {
  it("returns null for an empty array (caller early-outs)", () => {
    expect(computeBounds([])).toBeNull();
  });

  it("returns bounds covering all points", () => {
    const b = computeBounds(vegasRoute) as Bounds;
    expect(b).not.toBeNull();
    expect(b.minLat).toBe(36.1699);
    expect(b.maxLat).toBe(36.1712);
    expect(b.minLng).toBe(-115.1398);
    expect(b.maxLng).toBe(-115.1375);
  });

  it("covers points supplied in any order (min/max, not first/last)", () => {
    const b = computeBounds([
      { lat: 36.1712, lng: -115.1375 },
      { lat: 36.1699, lng: -115.1398 },
      { lat: 36.1705, lng: -115.1388 },
    ]) as Bounds;
    expect(b.minLat).toBe(36.1699);
    expect(b.maxLat).toBe(36.1712);
    expect(b.minLng).toBe(-115.1398);
    expect(b.maxLng).toBe(-115.1375);
  });

  it("yields a degenerate (min == max) bounds for a single point", () => {
    const b = computeBounds(singlePoint) as Bounds;
    expect(b.minLat).toBe(b.maxLat);
    expect(b.minLng).toBe(b.maxLng);
  });
});

describe("latLngToTile (DC33 floored slippy-map formula)", () => {
  it("floors (0,0) to tile {0,0} at zoom 0", () => {
    expect(latLngToTile(0, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("maps the equator/prime-meridian corner to {1,1} at zoom 1", () => {
    // x = floor((0+180)/360 * 2^1) = floor(1) = 1
    // y = floor((1 - log(tan0 + 1/cos0)/PI)/2 * 2^1) = floor(1) = 1
    expect(latLngToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });

  it("reproduces the x formula: floor((lng+180)/360 * 2^zoom)", () => {
    const zoom = 12;
    const lng = -115.1398;
    const expectedX = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
    expect(latLngToTile(36.1699, lng, zoom).x).toBe(expectedX);
  });

  it("returns finite integer tile coords for a Vegas point at zoom 15", () => {
    const t = latLngToTile(36.1699, -115.1398, 15);
    expect(Number.isInteger(t.x)).toBe(true);
    expect(Number.isInteger(t.y)).toBe(true);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x).toBeLessThan(Math.pow(2, 15));
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeLessThan(Math.pow(2, 15));
  });
});

describe("calculateZoomLevel (15→10, fallback 12)", () => {
  it("returns 15 for a tight route that fits one tile at max zoom", () => {
    const b = computeBounds(vegasRoute) as Bounds;
    expect(calculateZoomLevel(b)).toBe(15);
  });

  it("falls back to 12 when the bounds never fit within one tile", () => {
    // A whole-world span: 360° of longitude never fits in ≤1 tile at any
    // zoom in the 15→10 loop, so the fallback fires.
    const worldWide: Bounds = {
      minLat: -85,
      maxLat: 85,
      minLng: -180,
      maxLng: 180,
    };
    expect(calculateZoomLevel(worldWide)).toBe(12);
  });

  it("returns a valid zoom of 15 for a degenerate single-point bounds", () => {
    const b = computeBounds(singlePoint) as Bounds;
    expect(calculateZoomLevel(b)).toBe(15);
  });

  it("returns the FIRST (highest) zoom that fits, walking down from 15", () => {
    const b = computeBounds(vegasRoute) as Bounds;
    const zoom = calculateZoomLevel(b);
    // At the returned zoom the bounds span ≤1 tile in x and y…
    const topLeft = latLngToTile(b.maxLat, b.minLng, zoom);
    const bottomRight = latLngToTile(b.minLat, b.maxLng, zoom);
    expect(bottomRight.x - topLeft.x).toBeLessThanOrEqual(1);
    expect(bottomRight.y - topLeft.y).toBeLessThanOrEqual(1);
  });
});

describe("centerTile (midpoint → zoom → tile)", () => {
  it("returns {zoom,x,y} from the bounds midpoint at the computed zoom", () => {
    const b = computeBounds(vegasRoute) as Bounds;
    const zoom = calculateZoomLevel(b);
    const centerLat = (b.minLat + b.maxLat) / 2;
    const centerLng = (b.minLng + b.maxLng) / 2;
    const expected = latLngToTile(centerLat, centerLng, zoom);
    expect(centerTile(b)).toEqual({ zoom, x: expected.x, y: expected.y });
  });

  it("returns a finite tile for a degenerate single-point bounds", () => {
    const b = computeBounds(singlePoint) as Bounds;
    const t = centerTile(b);
    expect(t.zoom).toBe(15);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
    expect(Number.isInteger(t.x)).toBe(true);
    expect(Number.isInteger(t.y)).toBe(true);
  });
});
