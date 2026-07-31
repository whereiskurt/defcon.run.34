import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DC34 heat-map builder tests (Phase 71, HEAT-02).
 *
 * Everything runs through the injectable-deps seam — no DynamoDB, no S3. The
 * two real modules the builder reaches for at import time are mocked so the
 * default-deps path can never be reached accidentally (same guard style as
 * `gpx-reconcile.test.ts`).
 */

vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    scan: {
      where: () => {
        throw new Error("heatmap-build.test: default listRuns must not be reached");
      },
    },
  },
}));

vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: vi.fn() },
  BUCKET: "test-bucket",
}));

/**
 * `assertNonAttributable` is deliberately NOT a `BuildDeps` member — it is a
 * hard, non-injectable chokepoint on the write path (71-01's contract). To
 * assert that it actually runs BEFORE the PutObject we wrap the real export
 * with a recorder, keeping the genuine implementation underneath.
 */
const guard = vi.hoisted(() => ({
  order: [] as string[],
  forceThrow: false,
}));

vi.mock("@/lib/heatmap-artifact", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./heatmap-artifact")>();
  return {
    ...actual,
    assertNonAttributable: (artifact: unknown) => {
      guard.order.push("guard");
      if (guard.forceThrow) {
        throw new Error("assertNonAttributable: doctored feature");
      }
      return actual.assertNonAttributable(artifact);
    },
  };
});

import { assertNonAttributable } from "./heatmap-artifact";
import { buildDc34Heatmap, type HeatmapRunRow } from "./heatmap-build";

const CON_DAY = "2026-08-07"; // Friday, a real CON_DAYS[].date

/** A two-point GPX track, offset by `n` so each row's geometry is distinguishable. */
function gpx(n: number): string {
  const lat = 36.1 + n / 1000;
  return `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="${lat.toFixed(4)}" lon="-115.1398"></trkpt>
  <trkpt lat="${(lat + 0.001).toFixed(4)}" lon="-115.1400"></trkpt>
</trkseg></trk></gpx>`;
}

function row(over: Partial<HeatmapRunRow> = {}): HeatmapRunRow {
  return {
    userId: "sub-1",
    fileId: "f1",
    bucket: "b",
    key: "k1",
    status: "active",
    conDay: CON_DAY,
    createdAt: 1000,
    ...over,
  };
}

type Put = { key: string; body: string };

/** Standard harness: rows in, geometry keyed off `key`, one recorded put. */
function harness(
  rows: HeatmapRunRow[],
  opts: { loadGpx?: (bucket: string, key: string) => Promise<string> } = {}
) {
  const puts: Put[] = [];
  const loadGpx =
    opts.loadGpx ??
    (async (_bucket: string, key: string) => gpx(Number(key.replace(/\D/g, "")) || 0));
  return {
    puts,
    deps: {
      listRuns: async () => rows,
      loadGpx,
      putArtifact: async (key: string, body: string) => {
        guard.order.push("put");
        puts.push({ key, body });
      },
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    },
  };
}

function features(put: Put) {
  return (JSON.parse(put.body) as { features: unknown[] }).features as {
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: [number, number][] };
  }[];
}

beforeEach(() => {
  guard.order = [];
  guard.forceThrow = false;
});

describe("buildDc34Heatmap — selection", () => {
  it("includes an active, con-day-tagged, non-GLOBAL run with a two-point track", async () => {
    const h = harness([row()]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(1);
    expect(features(h.puts[0])).toHaveLength(1);
  });

  it("excludes a row whose status is not active", async () => {
    const h = harness([row({ status: "deleted" })]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(0);
  });

  it("excludes a row with no conDay", async () => {
    const h = harness([row({ conDay: undefined })]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(0);
  });

  it("excludes a row whose conDay is a real date outside CON_DAYS", async () => {
    const h = harness([row({ conDay: "2026-01-01" })]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(0);
  });

  it("excludes a GLOBAL-owned row", async () => {
    const h = harness([row({ userId: "GLOBAL" })]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(0);
  });

  /**
   * D-03 (Kurt, 2026-07-30): the owner opt-in gate is deliberately GONE from
   * this surface. This assertion fails against any implementation that kept —
   * or "restored" — the `includeInAggregate` predicate.
   */
  it("INCLUDES a row whose owner opt-in flag is false (D-03, no opt-in gate)", async () => {
    const h = harness([row({ includeInAggregate: false })]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(1);
  });
});

describe("buildDc34Heatmap — dedup", () => {
  it("collapses two rows sharing a stravaActivityId, keeping the earlier createdAt", async () => {
    const h = harness([
      row({ fileId: "late", key: "k9", createdAt: 5000, stravaActivityId: "act-1" }),
      row({ fileId: "early", key: "k2", createdAt: 1000, stravaActivityId: "act-1" }),
    ]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(1);
    // Geometry proves WHICH row survived: k2 → gpx(2), starting at lat 36.102.
    expect(features(h.puts[0])[0].geometry.coordinates[0][1]).toBeCloseTo(36.102, 5);
  });

  it("keeps rows with different or absent stravaActivityIds", async () => {
    const h = harness([
      row({ fileId: "a", key: "k1", stravaActivityId: "act-1" }),
      row({ fileId: "b", key: "k2", stravaActivityId: "act-2" }),
      row({ fileId: "c", key: "k3" }),
      row({ fileId: "d", key: "k4", stravaActivityId: "" }),
    ]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(4);
  });
});

describe("buildDc34Heatmap — geometry failures", () => {
  it("skips (and counts) a row whose loadGpx rejects, without aborting the batch", async () => {
    const h = harness(
      [row({ fileId: "bad", key: "k1" }), row({ fileId: "good", key: "k2" })],
      {
        loadGpx: async (_b, key) => {
          if (key === "k1") throw new Error("AccessDenied");
          return gpx(2);
        },
      }
    );
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("skips (and counts) a row whose GPX has fewer than two track points", async () => {
    const h = harness(
      [row({ fileId: "thin", key: "k1" }), row({ fileId: "good", key: "k2" })],
      {
        loadGpx: async (_b, key) =>
          key === "k1"
            ? `<gpx><trk><trkseg><trkpt lat="36.1" lon="-115.1"></trkpt></trkseg></trk></gpx>`
            : gpx(2),
      }
    );
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

describe("buildDc34Heatmap — result and artifact", () => {
  it("reports runCount matching the feature count and generatedAt from the injected clock", async () => {
    const h = harness([
      row({ fileId: "a", key: "k1" }),
      row({ fileId: "b", key: "k2" }),
      row({ fileId: "c", key: "k3" }),
    ]);
    const result = await buildDc34Heatmap(h.deps);
    expect(result.year).toBe("dc34");
    expect(result.generatedAt).toBe("2026-08-11T00:00:00.000Z");
    expect(result.runCount).toBe(features(h.puts[0]).length);
    expect(result.scanned).toBe(3);
  });

  it("writes exactly one object at uploads/HEATMAP/dc34.json with zero-property features", async () => {
    const h = harness([row({ fileId: "a", key: "k1" }), row({ fileId: "b", key: "k2" })]);
    await buildDc34Heatmap(h.deps);
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0].key).toBe("uploads/HEATMAP/dc34.json");
    const feats = features(h.puts[0]);
    expect(feats).toHaveLength(2);
    for (const f of feats) {
      expect(Object.keys(f.properties)).toHaveLength(0);
      expect(f.geometry.type).toBe("LineString");
    }
  });

  it("writes a body that the real non-attributability guard accepts", async () => {
    const h = harness([row()]);
    await buildDc34Heatmap(h.deps);
    // The genuine (unmocked-behaviour) assertion, re-run against what was written.
    expect(() => assertNonAttributable(JSON.parse(h.puts[0].body))).not.toThrow();
  });
});

describe("buildDc34Heatmap — non-attributability chokepoint ordering", () => {
  it("runs assertNonAttributable BEFORE putArtifact", async () => {
    const h = harness([row()]);
    await buildDc34Heatmap(h.deps);
    expect(guard.order).toEqual(["guard", "put"]);
  });

  it("throws and never writes when the guard rejects the artifact", async () => {
    guard.forceThrow = true;
    const h = harness([row()]);
    await expect(buildDc34Heatmap(h.deps)).rejects.toThrow(/assertNonAttributable/);
    expect(h.puts).toHaveLength(0);
    expect(guard.order).toEqual(["guard"]);
  });
});
