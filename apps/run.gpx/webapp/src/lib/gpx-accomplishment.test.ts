import { describe, it, expect, vi } from "vitest";
import {
  parseTrack,
  decimatePolyline,
  buildAccomplishmentPayload,
  notifyAccomplishment,
} from "./gpx-accomplishment";

// A tiny track: 4 points along a meridian with an ele profile of +10, -5, +15.
const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx>
  <trk><trkseg>
    <trkpt lat="36.1699" lon="-115.1398"><ele>600</ele></trkpt>
    <trkpt lat="36.1710" lon="-115.1398"><ele>610</ele></trkpt>
    <trkpt lat="36.1720" lon="-115.1398"><ele>605</ele></trkpt>
    <trkpt lat="36.1730" lon="-115.1398"><ele>620</ele></trkpt>
  </trkseg></trk>
</gpx>`;

// Helper: a straight synthetic line of `n` [lat,lon] tuples.
const line = (n: number): [number, number][] =>
  Array.from(
    { length: n },
    (_, i) => [36 + i * 0.001, -115 + i * 0.001] as [number, number]
  );

describe("parseTrack", () => {
  it("parses points, summed-haversine distance, positive-gain elevation", () => {
    const { points, distance, elevation } = parseTrack(SAMPLE_GPX);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual([36.1699, -115.1398]);
    // distance is a positive summed-haversine total (meters), rounded.
    expect(distance).toBeGreaterThan(0);
    // elevation = positive gains only: +10 + (ignore -5) + 15 = 25.
    expect(elevation).toBe(25);
  });
});

describe("decimatePolyline", () => {
  it(">max input caps at ≤max, preserves first & last, emits {lat,lng} objects", () => {
    const pts = line(250);
    const out = decimatePolyline(pts, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0]).toEqual({ lat: pts[0][0], lng: pts[0][1] });
    expect(out[out.length - 1]).toEqual({ lat: pts[249][0], lng: pts[249][1] });
    for (const p of out) {
      expect(Array.isArray(p)).toBe(false);
      expect(typeof p.lat).toBe("number");
      expect(typeof p.lng).toBe("number");
    }
  });

  it("≤max input returns all points as {lat,lng} objects", () => {
    const pts = line(40);
    const out = decimatePolyline(pts, 100);
    expect(out).toHaveLength(40);
    expect(out[0]).toEqual({ lat: pts[0][0], lng: pts[0][1] });
    expect(out[39]).toEqual({ lat: pts[39][0], lng: pts[39][1] });
  });
});

describe("buildAccomplishmentPayload", () => {
  it("assembles the run.human contract with a {lat,lng}[] polyline and no source", () => {
    const pts = line(250);
    const payload = buildAccomplishmentPayload({
      oidcSub: "sub-1",
      gpxFileId: "file-1",
      name: "My Run",
      points: pts,
      distance: 1234,
      elevation: 56,
      completedAt: 1720000000000,
    });
    expect(payload).toMatchObject({
      oidcSub: "sub-1",
      gpxFileId: "file-1",
      name: "My Run",
      distance: 1234,
      elevation: 56,
      completedAt: 1720000000000,
    });
    expect(payload.polyline.length).toBeLessThanOrEqual(100);
    expect(payload.polyline[0]).toEqual({ lat: pts[0][0], lng: pts[0][1] });
    // The endpoint SERVER-FIXES source:"gpx" — the producer must NOT send one.
    expect("source" in payload).toBe(false);
  });
});

describe("notifyAccomplishment", () => {
  it("resolves (never throws) when fetch rejects — best-effort, SC-4", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    const payload = buildAccomplishmentPayload({
      oidcSub: "s",
      gpxFileId: "f",
      name: "n",
      points: line(10),
      distance: 1,
      elevation: 1,
      completedAt: 1,
    });
    await expect(notifyAccomplishment(payload)).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
