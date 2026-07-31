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

import { assertNonAttributable, MAX_RUNS } from "./heatmap-artifact";
import {
  buildDc34Heatmap,
  compareRunRows,
  CHUNK_SIZE,
  type HeatmapRunRow,
} from "./heatmap-build";

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

/**
 * `HeatmapRunRow` deliberately does NOT declare the entity's owner opt-in flag —
 * the builder never reads it (D-03). Real scan rows still carry it, so the
 * override type is widened here to let the D-03 test set it and prove it is
 * ignored.
 */
type RowOverrides = Partial<HeatmapRunRow> & { includeInAggregate?: boolean };

function row(over: RowOverrides = {}): HeatmapRunRow {
  const base: HeatmapRunRow = {
    userId: "sub-1",
    fileId: "f1",
    bucket: "b",
    key: "k1",
    status: "active",
    conDay: CON_DAY,
    createdAt: 1000,
  };
  return { ...base, ...over };
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

/**
 * WR-03. `export const maxDuration` was inert under standalone output on ECS, so
 * the build had NO upper bound and the Terraform "contract" was written against
 * a fictional number. `BUILD_BUDGET_MS` is the real one, enforced in the chunk
 * loop — and these tests are the only thing that keeps it real.
 */
describe("buildDc34Heatmap — wall-clock deadline (WR-03)", () => {
  /** A clock that jumps `stepMs` on every read, starting at epoch 0. */
  function steppingClock(stepMs: number) {
    let t = 0;
    return () => {
      const at = new Date(t);
      t += stepMs;
      return at;
    };
  }

  /** 41 rows → 3 chunks at CHUNK_SIZE 20, so the loop reads the clock 3 times. */
  function manyRows(n: number) {
    return Array.from({ length: n }, (_, i) =>
      row({ fileId: `f${i}`, key: `k${i}` })
    );
  }

  it("REJECTS mid-loop once the budget is exceeded", async () => {
    const h = harness(manyRows(41));
    // start=0, chunk0=100s, chunk1=200s, chunk2=300s > 240s budget.
    const deps = { ...h.deps, now: steppingClock(100_000) };
    await expect(buildDc34Heatmap(deps)).rejects.toThrow(/budget|deadline/i);
  });

  it("does NOT publish a partial artifact on deadline — putArtifact is never called", async () => {
    const h = harness(manyRows(41));
    const deps = { ...h.deps, now: steppingClock(100_000) };
    await expect(buildDc34Heatmap(deps)).rejects.toThrow();
    expect(h.puts).toHaveLength(0);
    expect(guard.order).toEqual([]);
  });

  it("names the budget and the chunks completed, and leaks no identifier", async () => {
    const h = harness(manyRows(41));
    const deps = { ...h.deps, now: steppingClock(100_000) };
    const err = await buildDc34Heatmap(deps).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("240000");
    // Two chunks completed before the third read breached.
    expect(msg).toMatch(/\b2\b/);
    expect(msg).not.toMatch(/sub-1|f\d|k\d|uploads\//);
  });

  it("completes normally under a non-advancing clock and writes exactly once", async () => {
    const h = harness(manyRows(41));
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(41);
    expect(h.puts).toHaveLength(1);
  });
});

/**
 * WR-05. A capped build reported exactly MAX_RUNS and read as healthy, and paid
 * one S3 GetObject for every row it was about to discard.
 */
describe("buildDc34Heatmap — MAX_RUNS truncation (WR-05)", () => {
  it("stops issuing loads once the cap is reached, instead of loading every row", async () => {
    const rows = Array.from({ length: MAX_RUNS + 500 }, (_, i) =>
      row({ fileId: `f${i}`, key: `k${i}` })
    );
    let loads = 0;
    const h = harness(rows, {
      loadGpx: async (_b, key) => {
        loads++;
        return gpx(Number(key.replace(/\D/g, "")) || 0);
      },
    });
    const result = await buildDc34Heatmap(h.deps);
    expect(result.runCount).toBe(MAX_RUNS);
    // The loop may only overshoot by the in-flight chunk it was already running.
    expect(loads).toBeLessThanOrEqual(MAX_RUNS + CHUNK_SIZE);
    expect(loads).toBeLessThan(rows.length);
  });

  it("warns when the artifact is capped, naming MAX_RUNS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = Array.from({ length: MAX_RUNS + 500 }, (_, i) =>
      row({ fileId: `f${i}`, key: `k${i}` })
    );
    const h = harness(rows);
    await buildDc34Heatmap(h.deps);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("[heatmap]");
    expect(msg).toContain(String(MAX_RUNS));
    expect(msg).not.toMatch(/sub-1|uploads\//);
    warn.mockRestore();
  });

  it("does NOT warn on an uncapped build", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness([row({ fileId: "a", key: "k1" }), row({ fileId: "b", key: "k2" })]);
    await buildDc34Heatmap(h.deps);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * IN-01. `(a.fileId < b.fileId ? -1 : 1)` returned 1 for equal elements, which
 * violates the comparator contract the "deterministic output" property rests on.
 */
describe("compareRunRows — comparator consistency (IN-01)", () => {
  it("returns 0 for two rows with identical createdAt and identical fileId", () => {
    const a = row({ fileId: "same", createdAt: 1000 });
    const b = row({ fileId: "same", createdAt: 1000, key: "other" });
    expect(compareRunRows(a, b)).toBe(0);
    expect(compareRunRows(a, a)).toBe(0);
  });

  it("is antisymmetric on the fileId tie-break", () => {
    const a = row({ fileId: "aaa", createdAt: 1000 });
    const b = row({ fileId: "bbb", createdAt: 1000 });
    expect(Math.sign(compareRunRows(a, b))).toBe(-1);
    expect(Math.sign(compareRunRows(b, a))).toBe(1);
  });

  it("orders on createdAt before falling back to fileId", () => {
    const early = row({ fileId: "zzz", createdAt: 1 });
    const late = row({ fileId: "aaa", createdAt: 2 });
    expect(Math.sign(compareRunRows(early, late))).toBe(-1);
  });
});
