import { describe, it, expect } from "vitest";
import {
  buildGpxAccomplishmentInput,
  type GpxAccomplishmentBody,
} from "./gpx-accomplishment-input";
import { POINTS } from "./leaderboard-scoring";

/**
 * LDBR-06: the PURE gpx -> accomplishment payload seam.
 *
 * Proves the mapping WITHOUT S3/DynamoDB: fixes source "gpx" + POINTS.gpx,
 * threads polyline/distance/elevation, and throws on a bad payload (a malformed
 * body is a caller error, not a silent zero-score). The server-fixed source is
 * the type-level half of the LDBR-12 CTF write boundary — a body can never
 * inject ctf/qr.
 */

const good: GpxAccomplishmentBody = {
  gpxFileId: "gpx-9",
  name: "Morning Run",
  distance: 5000,
  elevation: 120,
  polyline: [
    { lat: 1, lng: 2 },
    { lat: 3, lng: 4 },
  ],
  completedAt: 1_700_000_000_000,
};

describe("buildGpxAccomplishmentInput", () => {
  it("maps a gpx body to a gpx/activity CreateAccomplishmentInput", () => {
    const input = buildGpxAccomplishmentInput(good, "uuid-1");
    expect(input.source).toBe("gpx");
    expect(input.type).toBe("activity");
    expect(input.points).toBe(POINTS.gpx);
    expect(input.userId).toBe("uuid-1");
    expect(input.gpxFileId).toBe("gpx-9");
    expect(input.name).toBe("Morning Run");
    expect(input.completedAt).toBe(good.completedAt);
    expect(input.distance).toBe(5000);
    expect(input.elevation).toBe(120);
    expect(input.polyline).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
  });

  it("server-fixes source to gpx even if the body tries to inject one (LDBR-12)", () => {
    const input = buildGpxAccomplishmentInput(
      { ...good, source: "ctf" } as GpxAccomplishmentBody,
      "uuid-1"
    );
    expect(input.source).toBe("gpx");
  });

  it("throws on a missing/blank name", () => {
    expect(() =>
      buildGpxAccomplishmentInput({ ...good, name: "   " }, "uuid-1")
    ).toThrow();
    expect(() =>
      buildGpxAccomplishmentInput({ ...good, name: undefined }, "uuid-1")
    ).toThrow();
  });

  it("throws on a missing gpxFileId", () => {
    expect(() =>
      buildGpxAccomplishmentInput({ ...good, gpxFileId: "" }, "uuid-1")
    ).toThrow();
  });

  it("throws on a missing/invalid completedAt", () => {
    expect(() =>
      buildGpxAccomplishmentInput({ ...good, completedAt: undefined }, "uuid-1")
    ).toThrow();
  });

  it("throws on a missing userId", () => {
    expect(() => buildGpxAccomplishmentInput(good, "")).toThrow();
  });

  it("omits optional metrics when absent (no undefined keys)", () => {
    const input = buildGpxAccomplishmentInput(
      { gpxFileId: "g", name: "n", completedAt: 1 },
      "uuid-1"
    );
    expect("distance" in input).toBe(false);
    expect("elevation" in input).toBe(false);
    expect("polyline" in input).toBe(false);
  });
});
