import { describe, it, expect } from "vitest";
import {
  decodePolyline,
  polylineToSvgPath,
  guessConDay,
  formatKm,
  isUnlimitedQuota,
} from "../../../gpx-studio/website/src/lib/logic/strava-strip-pure";

describe("decodePolyline", () => {
  it("decodes the canonical Google example", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
  it("is empty-safe", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("polylineToSvgPath", () => {
  it("normalizes into the viewBox with padding and inverted lat", () => {
    const d = polylineToSvgPath([[0, 0], [1, 1]], 100, 50, 10);
    // Aspect fit: lng span scales to min(innerW/span, innerH/span) = 30, centered
    // on x. South-west point → left-ish bottom, north-east point → right-ish top.
    expect(d).toMatch(/^M35,40 L65,10$/);
  });
  it("returns '' for fewer than 2 points", () => {
    expect(polylineToSvgPath([[1, 1]], 100, 50)).toBe("");
  });
});

describe("guessConDay", () => {
  const days = ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"];
  it("uses the exact day when the activity falls on a con day", () => {
    expect(guessConDay("2026-08-07T06:31:00Z", days)).toBe("2026-08-07");
  });
  // These three previously asserted nearest-con-day SNAPPING. That behaviour was
  // the bug: the strip shows the last 7+ days, so a pre-con activity turned up
  // with a con day pre-selected and was one tap from being logged as a con run.
  it("nulls before the window instead of snapping to the first con day", () => {
    expect(guessConDay("2026-08-01T09:00:00Z", days)).toBeNull();
  });
  it("nulls after the window instead of snapping to the last con day", () => {
    expect(guessConDay("2026-08-20T09:00:00Z", days)).toBeNull();
  });
  it("nulls on a near-miss rather than picking a neighbouring day", () => {
    expect(guessConDay("2026-08-07T00:00:00Z", ["2026-08-06", "2026-08-08"])).toBeNull();
  });
  it("nulls on garbage", () => {
    expect(guessConDay("not-a-date", days)).toBeNull();
    expect(guessConDay("2026-08-07T06:31:00Z", [])).toBeNull();
  });
});

describe("formatKm", () => {
  it("formats", () => {
    expect(formatKm(5400)).toBe("5.4 km");
    expect(formatKm(850)).toBe("850 m");
  });
});

describe("isUnlimitedQuota", () => {
  it("is false for real (non-admin) quota numbers", () => {
    expect(isUnlimitedQuota(2, 1)).toBe(false);
    expect(isUnlimitedQuota(0, 3)).toBe(false);
  });
  it("is true when remaining alone crosses the threshold (admin tier)", () => {
    expect(isUnlimitedQuota(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
  it("is true when count + remaining crosses the threshold", () => {
    expect(isUnlimitedQuota(50_000, 60_000)).toBe(true);
  });
  it("is false right at a realistic boundary", () => {
    expect(isUnlimitedQuota(10, 5)).toBe(false);
  });
});
