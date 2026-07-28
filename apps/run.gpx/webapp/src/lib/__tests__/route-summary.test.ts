import { describe, it, expect } from "vitest";
import { summarizeGpxText } from "../route-summary";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <wpt lat="36.1699" lon="-115.1398"><name>Start</name></wpt>
  <trk>
    <name>Strip out-and-back</name>
    <trkseg>
      <trkpt lat="36.1000" lon="-115.1500"><ele>610</ele></trkpt>
      <trkpt lat="36.1100" lon="-115.1500"><ele>615</ele></trkpt>
      <trkpt lat="36.1200" lon="-115.1400"><ele>612</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe("summarizeGpxText", () => {
  it("counts tracks and waypoints (not trkpt)", () => {
    const s = summarizeGpxText(FIXTURE);
    expect(s.trackCount).toBe(1);
    expect(s.waypointCount).toBe(1);
  });

  it("computes a positive distance and elevation gain", () => {
    const s = summarizeGpxText(FIXTURE);
    // ~1.1km north + ~1.4km NE — anything in the low-km range is right.
    expect(s.totalDistance).toBeGreaterThan(2000);
    expect(s.totalDistance).toBeLessThan(4000);
    expect(s.totalElevation).toBe(5); // only the +5 climb counts
  });

  it("derives bounds from track points", () => {
    const s = summarizeGpxText(FIXTURE);
    expect(s.bounds).toEqual({
      minLat: 36.1,
      maxLat: 36.12,
      minLon: -115.15,
      maxLon: -115.14,
    });
  });

  it("returns zeroed summary with no bounds for trackless gpx", () => {
    const s = summarizeGpxText(`<gpx version="1.1"></gpx>`);
    expect(s.trackCount).toBe(0);
    expect(s.waypointCount).toBe(0);
    expect(s.totalDistance).toBe(0);
    expect(s.bounds).toBeUndefined();
  });
});
