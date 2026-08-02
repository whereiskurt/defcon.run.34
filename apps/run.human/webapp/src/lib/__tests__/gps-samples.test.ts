import { describe, it, expect } from "vitest";
import {
  toGpsSample,
  bestAccuracyOf,
  SAMPLE_TARGET,
  SAMPLE_INTERVAL_MS,
  GEO_OPTIONS,
  type GpsSample,
} from "../gps-samples";

const sample = (accuracy: number): GpsSample => ({
  latitude: 36.17,
  longitude: -115.14,
  accuracy,
  timestamp: 1_000,
});

describe("toGpsSample", () => {
  it("maps a GeolocationPosition onto the wire shape", () => {
    const position = {
      coords: { latitude: 36.1699, longitude: -115.1398, accuracy: 12.5 },
    } as GeolocationPosition;

    expect(toGpsSample(position, 1_700_000_000_000)).toEqual({
      latitude: 36.1699,
      longitude: -115.1398,
      accuracy: 12.5,
      timestamp: 1_700_000_000_000,
    });
  });
});

describe("bestAccuracyOf", () => {
  it("returns the smallest accuracy -- the tightest fix wins", () => {
    expect(bestAccuracyOf([sample(30), sample(8), sample(19)])).toBe(8);
  });

  it("returns null for an empty list rather than Infinity", () => {
    expect(bestAccuracyOf([])).toBeNull();
  });
});

describe("sampling constants", () => {
  // The warm-start UX assumes ~2s to a fix. Pin the numbers so a future
  // tweak has to be deliberate.
  it("collects three samples spaced 667ms apart", () => {
    expect(SAMPLE_TARGET).toBe(3);
    expect(SAMPLE_INTERVAL_MS).toBe(667);
  });

  it("asks for high accuracy with a 10s ceiling", () => {
    expect(GEO_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 10000 });
  });
});
