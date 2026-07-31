import { describe, it, expect } from "vitest";
import { decodeTrack, MAX_POLYLINE_CHARS } from "@/lib/polyline-decode";

/**
 * The canonical Google encoded-polyline example. Decodes to
 * (38.5, -120.2), (40.7, -120.95), (43.252, -126.453) in [lat, lng] —
 * which this module must emit in GeoJSON [lon, lat] order.
 */
const CANONICAL = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

const near = (got: number, want: number) =>
  expect(Math.abs(got - want)).toBeLessThan(1e-5);

describe("decodeTrack — Google encoded polyline", () => {
  it("decodes the canonical example to [lon, lat] tuples", () => {
    const out = decodeTrack(CANONICAL);
    expect(out).toHaveLength(3);
    const want: [number, number][] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];
    out.forEach((pt, i) => {
      near(pt[0], want[i][0]);
      near(pt[1], want[i][1]);
    });
  });
});

describe("decodeTrack — DC33 JSON coordinate arrays", () => {
  it("reads a [lat, lon] pair array and swaps to [lon, lat]", () => {
    expect(
      decodeTrack(
        JSON.stringify([
          [36.1, -115.1],
          [36.2, -115.2],
        ])
      )
    ).toEqual([
      [-115.1, 36.1],
      [-115.2, 36.2],
    ]);
  });

  it("reads {lat, lng} objects to the same [lon, lat] tuples", () => {
    expect(
      decodeTrack(
        JSON.stringify([
          { lat: 36.1, lng: -115.1 },
          { lat: 36.2, lng: -115.2 },
        ])
      )
    ).toEqual([
      [-115.1, 36.1],
      [-115.2, 36.2],
    ]);
  });

  it("also accepts {lat, lon} objects", () => {
    expect(decodeTrack(JSON.stringify([{ lat: 36.1, lon: -115.1 }]))).toEqual([
      [-115.1, 36.1],
    ]);
  });

  it("returns [] when entries are neither pairs nor lat/lng objects", () => {
    expect(decodeTrack(JSON.stringify([1, 2, 3]))).toEqual([]);
    expect(decodeTrack(JSON.stringify(["a", "b"]))).toEqual([]);
    expect(decodeTrack(JSON.stringify([{ x: 1, y: 2 }]))).toEqual([]);
    expect(decodeTrack("[")).toEqual([]);
  });

  it("drops non-finite pairs", () => {
    expect(decodeTrack('[[36.1,null],["x",1],[36.2,-115.2]]')).toEqual([
      [-115.2, 36.2],
    ]);
  });

  it("is inert against a __proto__ key in the parsed JSON (T-71-02)", () => {
    const out = decodeTrack(
      '[{"lat":36.1,"lng":-115.1,"__proto__":{"polluted":true}}]'
    );
    expect(out).toEqual([[-115.1, 36.1]]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("decodeTrack — rejection paths", () => {
  it("returns [] for empty, whitespace-only, null-ish and junk strings", () => {
    expect(decodeTrack("")).toEqual([]);
    expect(decodeTrack("   \n\t ")).toEqual([]);
    expect(decodeTrack("null")).toEqual([]);
    expect(decodeTrack("~!@#$%^&*()")).toEqual([]);
  });

  it("returns [] for non-string input", () => {
    expect(decodeTrack(null)).toEqual([]);
    expect(decodeTrack(undefined)).toEqual([]);
    expect(decodeTrack(42)).toEqual([]);
    expect(decodeTrack({ summary_polyline: CANONICAL })).toEqual([]);
    expect(decodeTrack([[1, 2]])).toEqual([]);
  });

  it("returns [] for input longer than MAX_POLYLINE_CHARS without parsing", () => {
    const oversized = "_p~iF~ps|U".repeat(
      Math.ceil((MAX_POLYLINE_CHARS + 1) / 10)
    );
    expect(oversized.length).toBeGreaterThan(MAX_POLYLINE_CHARS);
    expect(decodeTrack(oversized)).toEqual([]);
  });

  it("still decodes input exactly at the bound (bound is inclusive)", () => {
    expect(MAX_POLYLINE_CHARS).toBe(200000);
    const atBound = "_p~iF~ps|U".repeat(MAX_POLYLINE_CHARS / 10);
    expect(atBound).toHaveLength(MAX_POLYLINE_CHARS);
    expect(decodeTrack(atBound).length).toBeGreaterThan(0);
  });

  it("never throws for any of the above", () => {
    const inputs: unknown[] = [
      CANONICAL,
      "",
      "   ",
      "null",
      "~!@#$%^&*()",
      "[",
      "[[1,2]",
      '[{"lat":1}]',
      null,
      undefined,
      42,
      {},
      [],
      " ",
      "_p~iF~ps|U_ulL",
    ];
    for (const input of inputs) {
      expect(() => decodeTrack(input)).not.toThrow();
      expect(Array.isArray(decodeTrack(input))).toBe(true);
    }
  });
});
