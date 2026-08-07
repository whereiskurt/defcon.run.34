import { describe, it, expect } from "vitest";
import {
  buildRunShape,
  trkptTimes,
  MAX_SHAPE_POINTS,
  VEGAS_BOX,
} from "@/lib/heatmap-shape";

/**
 * A plausible Las Vegas run: a ~2 km straight-ish line along the Strip, sampled
 * every few metres. This is the CONTROL for every signal test below — a
 * heuristic that fires on this is a heuristic that flags the whole con.
 */
function vegasRun(points = 400): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    coords.push([-115.172 + t * 0.02, 36.114 + t * 0.008]);
  }
  return coords;
}

/** Even timestamps at `metresPerSecond` implied by the caller's spacing. */
function evenTimes(count: number, stepSeconds: number): number[] {
  const t0 = Date.parse("2026-08-06T13:00:00Z");
  return Array.from({ length: count }, (_, i) => t0 + i * stepSeconds * 1000);
}

describe("buildRunShape — geometry", () => {
  it("emits an SVG path that starts with a moveto and has no NaN", () => {
    const shape = buildRunShape(vegasRun());
    expect(shape.path.startsWith("M")).toBe(true);
    expect(shape.path).not.toContain("NaN");
    expect(shape.path).not.toContain("Infinity");
  });

  it("reports the ORIGINAL point count, not the decimated one", () => {
    const shape = buildRunShape(vegasRun(900));
    expect(shape.points).toBe(900);
    // …while the path itself is capped.
    const commands = shape.path.split(/(?=[ML])/).length;
    expect(commands).toBeLessThanOrEqual(MAX_SHAPE_POINTS);
  });

  it("keeps the first and last coordinate when it decimates", () => {
    const coords = vegasRun(1000);
    const shape = buildRunShape(coords);
    const nums = shape.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [firstX, firstY] = [nums[0], nums[1]];
    const [lastX, lastY] = [nums[nums.length - 2], nums[nums.length - 1]];

    // The run travels up and to the right, and SVG y is inverted, so the first
    // point must sit bottom-left and the last top-right of the normalized box.
    expect(firstX).toBeLessThan(lastX);
    expect(firstY).toBeGreaterThan(lastY);
  });

  it("preserves aspect ratio — a north-south run is not rendered square", () => {
    // Tall and narrow: 0.0002 deg of longitude, 0.02 deg of latitude.
    const coords: [number, number][] = Array.from({ length: 50 }, (_, i) => [
      -115.17 + i * 0.000004,
      36.10 + i * 0.0004,
    ]);
    const shape = buildRunShape(coords);
    const [, , w, h] = shape.viewBox.split(" ").map(Number);
    expect(h).toBeGreaterThan(w * 5);
  });

  it("renders a degenerate (single-point) track as a dot, not a divide-by-zero", () => {
    const shape = buildRunShape([[-115.17, 36.11]]);
    expect(shape.path).not.toContain("NaN");
    expect(shape.viewBox).not.toContain("NaN");
    expect(shape.spanMeters).toBe(0);
  });

  it("returns an empty path and the no-gps signal for a trackless run", () => {
    const shape = buildRunShape([]);
    expect(shape.path).toBe("");
    expect(shape.points).toBe(0);
    expect(shape.signals).toEqual(["no-gps"]);
  });
});

describe("buildRunShape — signals", () => {
  it("flags NOTHING on an ordinary Vegas run", () => {
    expect(buildRunShape(vegasRun()).signals).toEqual([]);
  });

  it("flags nothing on an ordinary Vegas run that carries timestamps", () => {
    const coords = vegasRun(400);
    // ~2.2 km over 400 samples at 3 s apart ≈ 6.6 km/h. A jog.
    const shape = buildRunShape(coords, evenTimes(400, 3));
    expect(shape.signals).toEqual([]);
  });

  it("flags drawn-in-place for many points inside a tiny box", () => {
    // 400 points scribbled inside ~80 m — the glyph signature.
    const coords: [number, number][] = Array.from({ length: 400 }, (_, i) => [
      -115.17 + Math.sin(i / 3) * 0.0004,
      36.11 + Math.cos(i / 5) * 0.0003,
    ]);
    expect(buildRunShape(coords).signals).toContain("drawn-in-place");
  });

  it("does NOT flag drawn-in-place for a short walk with few points", () => {
    // Same tiny box, but only 20 samples — a legitimately short recording.
    const coords: [number, number][] = Array.from({ length: 20 }, (_, i) => [
      -115.17 + i * 0.00002,
      36.11 + i * 0.00002,
    ]);
    expect(buildRunShape(coords).signals).not.toContain("drawn-in-place");
  });

  it("flags teleport on a jump over a kilometre", () => {
    const coords: [number, number][] = [
      ...vegasRun(50),
      [-115.30, 36.20], // ~13 km away in one step
      [-115.301, 36.201],
    ];
    expect(buildRunShape(coords).signals).toContain("teleport");
  });

  it("flags off-site for a track outside the Las Vegas box", () => {
    const coords: [number, number][] = Array.from({ length: 50 }, (_, i) => [
      -122.4 + i * 0.0002, // San Francisco
      37.77 + i * 0.0002,
    ]);
    expect(buildRunShape(coords).signals).toContain("off-site");
  });

  it("does not flag off-site for a run at the edges of the box", () => {
    const coords: [number, number][] = [
      [VEGAS_BOX.minLon + 0.001, VEGAS_BOX.minLat + 0.001],
      [VEGAS_BOX.maxLon - 0.001, VEGAS_BOX.maxLat - 0.001],
    ];
    expect(buildRunShape(coords).signals).not.toContain("off-site");
  });

  it("flags fast when timestamps imply vehicle speed", () => {
    // vegasRun(400) is ~2.2 km; covering it in 100 s is ~80 km/h.
    const shape = buildRunShape(vegasRun(400), evenTimes(400, 100 / 400));
    expect(shape.signals).toContain("fast");
  });

  it("never flags fast without timestamps, however implausible the geometry", () => {
    const coords: [number, number][] = [
      [-115.17, 36.11],
      [-115.30, 36.20],
    ];
    expect(buildRunShape(coords).signals).not.toContain("fast");
  });

  it("ignores a timestamp array that does not match the coordinate count", () => {
    const shape = buildRunShape(vegasRun(400), evenTimes(12, 1));
    expect(shape.signals).not.toContain("fast");
  });
});

describe("trkptTimes", () => {
  it("extracts trkpt timestamps in document order", () => {
    const gpx = `<trk><trkseg>
      <trkpt lat="36.11" lon="-115.17"><time>2026-08-06T13:00:00Z</time></trkpt>
      <trkpt lat="36.12" lon="-115.18"><time>2026-08-06T13:00:10Z</time></trkpt>
    </trkseg></trk>`;
    const times = trkptTimes(gpx);
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBe(10_000);
  });

  it("returns an empty array when the GPX carries no times", () => {
    const gpx = `<trkpt lat="36.11" lon="-115.17"></trkpt>`;
    expect(trkptTimes(gpx)).toEqual([]);
  });

  it("drops an unparsable timestamp rather than emitting NaN", () => {
    const gpx = `
      <trkpt lat="36.11" lon="-115.17"><time>not-a-date</time></trkpt>
      <trkpt lat="36.12" lon="-115.18"><time>2026-08-06T13:00:10Z</time></trkpt>`;
    const times = trkptTimes(gpx);
    expect(times.every(Number.isFinite)).toBe(true);
  });
});
