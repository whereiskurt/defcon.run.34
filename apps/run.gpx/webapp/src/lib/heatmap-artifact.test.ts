import { describe, it, expect } from "vitest";
import {
  HEATMAP_YEARS,
  isHeatmapYear,
  heatmapArtifactKey,
  MAX_TRACK_POINTS,
  MAX_RUNS,
  trkptCoords,
  normalizeTrack,
  trackKm,
  assembleHeatmapArtifact,
  assertNonAttributable,
  type HeatmapArtifact,
} from "@/lib/heatmap-artifact";

const GPX_TWO_POINTS = `<?xml version="1.0"?>
<gpx version="1.1"><trk><name>test</name><trkseg>
  <trkpt lat="36.10000" lon="-115.10000"><ele>600</ele></trkpt>
  <trkpt lat="36.20000" lon="-115.20000"><ele>610</ele></trkpt>
</trkseg></trk></gpx>`;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("HEATMAP_YEARS / isHeatmapYear", () => {
  it("lists both con years", () => {
    expect([...HEATMAP_YEARS]).toEqual(["dc33", "dc34"]);
  });

  it("accepts exactly dc33 and dc34", () => {
    expect(isHeatmapYear("dc33")).toBe(true);
    expect(isHeatmapYear("dc34")).toBe(true);
  });

  it("rejects everything else, including path traversal and case variants", () => {
    expect(isHeatmapYear("dc32")).toBe(false);
    expect(isHeatmapYear("DC34")).toBe(false);
    expect(isHeatmapYear("../../etc/passwd")).toBe(false);
    expect(isHeatmapYear("")).toBe(false);
    expect(isHeatmapYear(null)).toBe(false);
    expect(isHeatmapYear(undefined)).toBe(false);
    expect(isHeatmapYear(123)).toBe(false);
  });
});

describe("heatmapArtifactKey", () => {
  it("returns the IAM-permitted uploads/ key for each year", () => {
    expect(heatmapArtifactKey("dc33")).toBe("uploads/HEATMAP/dc33.json");
    expect(heatmapArtifactKey("dc34")).toBe("uploads/HEATMAP/dc34.json");
  });

  it("always lives under the uploads/ prefix the S3 IAM user is scoped to", () => {
    for (const y of HEATMAP_YEARS) {
      expect(heatmapArtifactKey(y).startsWith("uploads/")).toBe(true);
    }
  });
});

describe("trkptCoords", () => {
  it("returns [lon, lat] pairs in document order", () => {
    expect(trkptCoords(GPX_TWO_POINTS)).toEqual([
      [-115.1, 36.1],
      [-115.2, 36.2],
    ]);
  });

  it("returns [] when there are no track points", () => {
    expect(trkptCoords("<gpx><trk><trkseg></trkseg></trk></gpx>")).toEqual([]);
  });
});

describe("normalizeTrack", () => {
  it("drops non-finite entries", () => {
    expect(
      normalizeTrack([
        [-115.1, 36.1],
        [NaN, 36.2],
        [-115.3, Infinity],
        [-Infinity, -Infinity],
        [-115.4, 36.4],
      ])
    ).toEqual([
      [-115.1, 36.1],
      [-115.4, 36.4],
    ]);
  });

  it("drops out-of-range longitudes and latitudes", () => {
    expect(
      normalizeTrack([
        [-115.1, 36.1],
        [181, 36.2],
        [-180.5, 36.3],
        [-115.4, 90.1],
        [-115.5, -90.1],
        [-115.6, 36.6],
      ])
    ).toEqual([
      [-115.1, 36.1],
      [-115.6, 36.6],
    ]);
  });

  it("rounds every surviving number to 5 decimal places", () => {
    expect(normalizeTrack([[1.123456789, 2.987654321]])).toEqual([
      [1.12346, 2.98765],
    ]);
  });

  it("decimates 1000 points to exactly MAX_TRACK_POINTS keeping first and last", () => {
    const input = Array.from(
      { length: 1000 },
      (_, i) => [i * 0.001, i * 0.0005] as [number, number]
    );
    const out = normalizeTrack(input);
    expect(out).toHaveLength(MAX_TRACK_POINTS);
    expect(MAX_TRACK_POINTS).toBe(300);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0.999, 0.4995]);
  });

  it("leaves short tracks untouched", () => {
    const input = Array.from(
      { length: 10 },
      (_, i) => [i * 0.1, i * 0.2] as [number, number]
    );
    const out = normalizeTrack(input);
    expect(out).toHaveLength(10);
    expect(out).toEqual(input.map(([lon, lat]) => [round5(lon), round5(lat)]));
  });
});

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

describe("trackKm", () => {
  it("measures one degree of latitude as ~111.2 km", () => {
    expect(
      trackKm([
        [0, 0],
        [0, 1],
      ])
    ).toBeGreaterThan(110.7);
    expect(
      trackKm([
        [0, 0],
        [0, 1],
      ])
    ).toBeLessThan(111.7);
  });

  it("returns 0 for a single-point track", () => {
    expect(trackKm([[-115.1, 36.1]])).toBe(0);
    expect(trackKm([])).toBe(0);
  });
});

describe("assembleHeatmapArtifact", () => {
  const GENERATED_AT = "2026-07-30T12:00:00.000Z";

  it("drops tracks with fewer than 2 coordinates and reports runCount", () => {
    const art = assembleHeatmapArtifact("dc34", GENERATED_AT, [
      [
        [0, 0],
        [0, 1],
      ],
      [[0, 0]],
      [],
      [
        [1, 1],
        [1, 2],
      ],
    ]);
    expect(art.type).toBe("FeatureCollection");
    expect(art.features).toHaveLength(2);
    expect(art.meta.runCount).toBe(art.features.length);
    expect(art.meta.year).toBe("dc34");
    expect(art.meta.generatedAt).toBe(GENERATED_AT);
  });

  it("sums totalKm rounded to one decimal", () => {
    const art = assembleHeatmapArtifact("dc33", GENERATED_AT, [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0, 0],
        [0, 1],
      ],
    ]);
    expect(art.meta.totalKm).toBe(222.4);
    expect(art.meta.totalKm * 10).toBe(Math.round(art.meta.totalKm * 10));
  });

  it("caps output at MAX_RUNS features", () => {
    const tracks = Array.from(
      { length: MAX_RUNS + 1 },
      () =>
        [
          [0, 0],
          [0, 0.001],
        ] as [number, number][]
    );
    const art = assembleHeatmapArtifact("dc34", GENERATED_AT, tracks);
    expect(art.features).toHaveLength(MAX_RUNS);
    expect(art.meta.runCount).toBe(MAX_RUNS);
  });

  it("emits bare, non-attributable features only", () => {
    const art = assembleHeatmapArtifact("dc34", GENERATED_AT, [
      [
        [0, 0],
        [0, 1],
      ],
    ]);
    for (const f of art.features) {
      expect(Object.keys(f).sort()).toEqual([
        "geometry",
        "properties",
        "type",
      ]);
      expect(f.properties).toEqual({});
      expect(Object.keys(f.properties)).toHaveLength(0);
      expect(f.geometry.type).toBe("LineString");
    }
  });

  // WR-06 — 20 of the 110 live DC33 features are entirely [[0,0],[0,0]].
  it("drops a null-island track that never moves", () => {
    const art = assembleHeatmapArtifact("dc34", GENERATED_AT, [
      [
        [0, 0],
        [0, 0],
      ],
    ]);
    expect(art.features).toEqual([]);
    expect(art.meta.runCount).toBe(0);
  });

  it("drops a never-moving track that is NOT at null island", () => {
    const art = assembleHeatmapArtifact("dc34", GENERATED_AT, [
      [
        [-115.1398, 36.1699],
        [-115.1398, 36.1699],
        [-115.1398, 36.1699],
      ],
    ]);
    expect(art.features).toEqual([]);
    expect(art.meta.runCount).toBe(0);
  });

  it("keeps a genuine two-point track that actually moves", () => {
    const art = assembleHeatmapArtifact("dc34", GENERATED_AT, [
      [
        [-115.1398, 36.1699],
        [-115.1428, 36.1729],
      ],
    ]);
    expect(art.features).toHaveLength(1);
    expect(art.meta.runCount).toBe(1);
    expect(art.features[0].geometry.coordinates).toHaveLength(2);
  });

  it("drops only the degenerate track when mixed with real ones", () => {
    const art = assembleHeatmapArtifact("dc33", GENERATED_AT, [
      [
        [-115.1398, 36.1699],
        [-115.1428, 36.1729],
      ],
      [
        [0, 0],
        [0, 0],
      ],
      [
        [-115.15, 36.18],
        [-115.16, 36.19],
      ],
    ]);
    expect(art.features).toHaveLength(2);
    expect(art.meta.runCount).toBe(2);
  });
});

describe("assertNonAttributable", () => {
  const fresh = (): HeatmapArtifact =>
    assembleHeatmapArtifact("dc34", "2026-07-30T12:00:00.000Z", [
      [
        [0, 0],
        [0, 1],
      ],
    ]);

  it("passes a freshly assembled artifact", () => {
    expect(() => assertNonAttributable(fresh())).not.toThrow();
  });

  it("throws when a feature carries any property key", () => {
    const bad = clone(fresh()) as unknown as {
      features: { properties: Record<string, unknown> }[];
    };
    bad.features[0].properties = { userId: "x" };
    expect(() => assertNonAttributable(bad)).toThrow(/properties/);
  });

  it("throws when a feature carries an extra top-level key", () => {
    const bad = clone(fresh()) as unknown as {
      features: Record<string, unknown>[];
    };
    bad.features[0].id = "gpx-123";
    expect(() => assertNonAttributable(bad)).toThrow(/id/);
  });

  it("throws when the artifact root carries an unexpected key", () => {
    const bad = clone(fresh()) as unknown as Record<string, unknown>;
    bad.owners = ["someone"];
    expect(() => assertNonAttributable(bad)).toThrow(/owners/);
  });

  it("throws when the root is not an object or features is not an array", () => {
    expect(() => assertNonAttributable(null)).toThrow();
    expect(() => assertNonAttributable("nope")).toThrow();
    expect(() => assertNonAttributable([])).toThrow();
    expect(() =>
      assertNonAttributable({
        type: "FeatureCollection",
        meta: {},
        features: "nope",
      })
    ).toThrow(/features/);
  });

  it("throws on a non-LineString geometry or an extra geometry key", () => {
    const badType = clone(fresh()) as unknown as {
      features: { geometry: Record<string, unknown> }[];
    };
    badType.features[0].geometry.type = "Point";
    expect(() => assertNonAttributable(badType)).toThrow(/LineString/);

    const badKey = clone(fresh()) as unknown as {
      features: { geometry: Record<string, unknown> }[];
    };
    badKey.features[0].geometry.stravaActivityId = "999";
    expect(() => assertNonAttributable(badKey)).toThrow(/stravaActivityId/);
  });

  // ── WR-01: the three blind spots the guard's docstring implied it covered ──

  it("throws when the root type is not FeatureCollection", () => {
    const bad = clone(fresh()) as unknown as Record<string, unknown>;
    bad.type = "Feature";
    expect(() => assertNonAttributable(bad)).toThrow(/FeatureCollection/);
  });

  it("throws when meta carries an unexpected key, naming it", () => {
    const bad = clone(fresh()) as unknown as {
      meta: Record<string, unknown>;
    };
    bad.meta.generatedBy = "builder";
    expect(() => assertNonAttributable(bad)).toThrow(/generatedBy/);
  });

  it("throws when meta is absent or is not a plain object", () => {
    const missing = clone(fresh()) as unknown as Record<string, unknown>;
    delete missing.meta;
    expect(() => assertNonAttributable(missing)).toThrow(/meta/);

    const arrayMeta = clone(fresh()) as unknown as Record<string, unknown>;
    arrayMeta.meta = [];
    expect(() => assertNonAttributable(arrayMeta)).toThrow(/meta/);

    const scalarMeta = clone(fresh()) as unknown as Record<string, unknown>;
    scalarMeta.meta = "dc34";
    expect(() => assertNonAttributable(scalarMeta)).toThrow(/meta/);
  });

  it("throws when geometry.coordinates is not an array", () => {
    const bad = clone(fresh()) as unknown as {
      features: { geometry: Record<string, unknown> }[];
    };
    bad.features[0].geometry.coordinates = "-115.1,36.1";
    expect(() => assertNonAttributable(bad)).toThrow(/coordinates/);
  });

  it("throws on a malformed coordinate, naming the feature index", () => {
    const stringCoord = clone(fresh()) as unknown as {
      features: { geometry: { coordinates: unknown[] } }[];
    };
    stringCoord.features[0].geometry.coordinates[1] = "0,1";
    expect(() => assertNonAttributable(stringCoord)).toThrow(/features\[0\]/);

    const tripleCoord = clone(fresh()) as unknown as {
      features: { geometry: { coordinates: unknown[] } }[];
    };
    tripleCoord.features[0].geometry.coordinates[1] = [0, 1, 600];
    expect(() => assertNonAttributable(tripleCoord)).toThrow(/features\[0\]/);

    const nonNumeric = clone(fresh()) as unknown as {
      features: { geometry: { coordinates: unknown[] } }[];
    };
    nonNumeric.features[0].geometry.coordinates[1] = ["0", "1"];
    expect(() => assertNonAttributable(nonNumeric)).toThrow(/features\[0\]/);
  });

  it("still accepts a real multi-run artifact after the widening", () => {
    const long = Array.from(
      { length: 900 },
      (_, i) => [-115.1 + i * 0.0002, 36.1 + i * 0.0001] as [number, number]
    );
    const art = assembleHeatmapArtifact("dc33", "2026-07-30T12:00:00.000Z", [
      long,
      [
        [-115.2, 36.2],
        [-115.21, 36.21],
      ],
    ]);
    expect(art.features).toHaveLength(2);
    expect(() => assertNonAttributable(art)).not.toThrow();
  });
});
