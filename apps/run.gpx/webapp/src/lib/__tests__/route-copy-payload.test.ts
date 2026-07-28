import { describe, it, expect } from "vitest";
import { buildRouteCopyPayload } from "../route-copy";

const route = {
  name: "Vegas Loop",
  fileSize: 1234,
  trackCount: 1,
  waypointCount: 2,
  totalDistance: 5000,
  totalElevation: 40,
  bounds: { minLat: 36.1, maxLat: 36.2, minLon: -115.2, maxLon: -115.1 },
};

describe("buildRouteCopyPayload", () => {
  it("never carries conDay or stravaActivityId (double-scoring guard)", () => {
    const p = buildRouteCopyPayload(route, "sub-123", "file-1", "bkt", "k");
    expect("conDay" in p).toBe(false);
    expect("stravaActivityId" in p).toBe(false);
  });

  it("assigns the copy to the caller, in ROOT, active, source converted", () => {
    const p = buildRouteCopyPayload(route, "sub-123", "file-1", "bkt", "k");
    expect(p.userId).toBe("sub-123");
    expect(p.fileId).toBe("file-1");
    expect(p.folderId).toBe("ROOT");
    expect(p.source).toBe("converted");
    expect(p.status).toBe("active");
  });

  it("derives the file name from the route name with .gpx suffix", () => {
    expect(
      buildRouteCopyPayload(route, "s", "f", "b", "k").fileName
    ).toBe("Vegas Loop.gpx");
    expect(
      buildRouteCopyPayload({ ...route, name: "trail.GPX" }, "s", "f", "b", "k")
        .fileName
    ).toBe("trail.GPX");
  });

  it("carries geometry summary through", () => {
    const p = buildRouteCopyPayload(route, "s", "f", "b", "k");
    expect(p.totalDistance).toBe(5000);
    expect(p.bounds).toEqual(route.bounds);
  });
});
