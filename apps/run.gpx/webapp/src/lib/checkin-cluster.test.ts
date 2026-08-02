import { describe, it, expect } from "vitest";

/**
 * Tests for the studio's semantic check-in clustering.
 *
 * The module lives in gpx-studio (where the map uses it) but the studio has no
 * test runner, so it is exercised from the webapp's vitest by relative path —
 * the alternative was leaving the map's clustering entirely untested.
 */
import {
  clusterCheckins,
  haversineMeters,
  DEFAULT_MAP_CLUSTER_CONFIG as CFG,
  type CheckinPoint,
} from "../../../gpx-studio/website/src/lib/checkin-cluster";

const BASE_LAT = 36.1147;
const BASE_LNG = -115.1728;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 90_000;

function offset(northM: number, eastM: number) {
  return {
    lat: BASE_LAT + northM / M_PER_DEG_LAT,
    lng: BASE_LNG + eastM / M_PER_DEG_LNG,
  };
}

let seq = 0;
function pt(rid: string, t: number, pos: { lat: number; lng: number }): CheckinPoint {
  seq += 1;
  return { id: `c${seq}`, rid, lat: pos.lat, lng: pos.lng, t };
}

/** `n` runners near `centre`, arriving evenly across `spanMin`. */
function group(
  prefix: string,
  n: number,
  startT: number,
  spanMin: number,
  centre: { lat: number; lng: number },
  spreadM: number,
): CheckinPoint[] {
  const out: CheckinPoint[] = [];
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0 : i / (n - 1);
    const angle = i * 2.399963;
    const r = spreadM * Math.sqrt((i % 7) / 7);
    out.push(
      pt(`${prefix}-${i}`, startT + Math.round(frac * spanMin * 60_000), {
        lat: centre.lat + (r * Math.cos(angle)) / M_PER_DEG_LAT,
        lng: centre.lng + (r * Math.sin(angle)) / M_PER_DEG_LNG,
      }),
    );
  }
  return out;
}

const T0 = Date.UTC(2026, 7, 5, 13, 12); // Wed Aug 5, 6:12am PDT

describe("haversineMeters", () => {
  it("measures a known offset", () => {
    const a = offset(0, 0);
    const b = offset(100, 0);
    expect(haversineMeters(a.lat, a.lng, b.lat, b.lng)).toBeCloseTo(100, 0);
  });
});

describe("clusterCheckins — grouping", () => {
  it("turns a corral into ONE cluster with no leftover pins", () => {
    const pts = group("corral", 31, T0, 40, offset(0, 0), 100);
    const { clusters, orphans } = clusterCheckins(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(31);
    expect(orphans).toEqual([]);
    expect(clusters[0].memberIds).toHaveLength(31);
  });

  it("leaves a sub-threshold group entirely as orphan pins", () => {
    const pts = group("small", 3, T0, 5, offset(0, 0), 40);
    const { clusters, orphans } = clusterCheckins(pts, CFG);

    expect(clusters).toEqual([]);
    expect(orphans).toHaveLength(3);
  });

  it("clusters the crowd and orphans the stragglers in one pass", () => {
    const pts = [
      ...group("crowd", 10, T0, 20, offset(0, 0), 80),
      ...group("far", 2, T0, 5, offset(0, 3000), 20),
    ];
    const { clusters, orphans } = clusterCheckins(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(10);
    expect(orphans).toHaveLength(2);
  });

  it("keeps two groups 250m apart separate", () => {
    const pts = [
      ...group("west", 6, T0, 10, offset(0, 0), 30),
      ...group("east", 6, T0, 10, offset(0, 250), 30),
    ];
    const { clusters, orphans } = clusterCheckins(pts, CFG);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.size === 6)).toBe(true);
    expect(orphans).toEqual([]);
  });
});

describe("clusterCheckins — every point lands exactly once", () => {
  const pts = [
    ...group("a", 9, T0, 20, offset(0, 0), 120),
    ...group("b", 5, T0 + 14 * 3600_000, 10, offset(0, 900), 60),
    ...group("c", 3, T0 + 26 * 3600_000, 5, offset(900, 0), 40),
  ];
  const { clusters, orphans } = clusterCheckins(pts, CFG);

  it("partitions the input — no point lost, none duplicated", () => {
    const clustered = clusters.flatMap((c) => c.memberIds);
    const all = [...clustered, ...orphans.map((o) => o.id)];

    expect(new Set(all).size).toBe(all.length); // no duplicates
    expect(new Set(all)).toEqual(new Set(pts.map((p) => p.id))); // none lost
  });

  it("finds the two qualifying groups and orphans the third", () => {
    expect(clusters.map((c) => c.size)).toEqual([9, 5]);
    expect(orphans).toHaveLength(3);
  });
});

describe("clusterCheckins — runner identity", () => {
  it("counts RUNNERS, not check-ins", () => {
    // Four check-ins, but only two runners — under minRunners of 4.
    const centre = offset(0, 0);
    const pts = [
      pt("r1", T0, centre),
      pt("r1", T0 + 60_000, centre),
      pt("r2", T0 + 120_000, centre),
      pt("r2", T0 + 180_000, centre),
    ];
    const { clusters, orphans } = clusterCheckins(pts, CFG);

    expect(clusters).toEqual([]);
    expect(orphans).toHaveLength(4);
  });

  it("absorbs a runner's REPEAT check-ins so none floats over the cluster", () => {
    const centre = offset(0, 0);
    const pts = [
      ...group("g", 5, T0, 10, centre, 40),
      pt("g-0", T0 + 3 * 60_000, centre), // same runner checks in again
      pt("g-1", T0 + 4 * 60_000, centre),
    ];
    const { clusters, orphans } = clusterCheckins(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(5); // still five RUNNERS
    expect(clusters[0].memberIds).toHaveLength(7); // but seven check-ins absorbed
    expect(orphans).toEqual([]);
  });

  it("does not let a shared anonymous name merge distinct runners", () => {
    // All these would be "a rabbit" by displayName; distinct rids keep them apart.
    const pts = group("anon", 6, T0, 10, offset(0, 0), 40);
    const { clusters } = clusterCheckins(pts, CFG);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(6);
  });
});

describe("clusterCheckins — determinism and config", () => {
  const pts = [
    ...group("a", 8, T0, 20, offset(0, 0), 100),
    ...group("b", 5, T0 + 14 * 3600_000, 10, offset(0, 900), 60),
  ];

  it("is order-independent and repeatable", () => {
    const forward = clusterCheckins(pts, CFG);
    const reversed = clusterCheckins([...pts].reverse(), CFG);
    expect(forward.clusters).toEqual(reversed.clusters);
    expect(new Set(forward.orphans.map((o) => o.id))).toEqual(
      new Set(reversed.orphans.map((o) => o.id)),
    );
  });

  it("a tighter radius breaks a spread-out crowd apart", () => {
    const spread = group("spread", 10, T0, 10, offset(0, 0), 190);
    expect(clusterCheckins(spread, CFG).clusters[0].size).toBe(10);

    const tight = clusterCheckins(spread, { ...CFG, radiusMeters: 40 });
    expect(tight.clusters.every((c) => c.size < 10)).toBe(true);
  });

  it("raising minRunners drops the smaller group to orphans", () => {
    const strict = clusterCheckins(pts, { ...CFG, minRunners: 8 });
    expect(strict.clusters).toHaveLength(1);
    expect(strict.clusters[0].size).toBe(8);
    expect(strict.orphans).toHaveLength(5);
  });

  it("handles an empty input", () => {
    expect(clusterCheckins([], CFG)).toEqual({ clusters: [], orphans: [] });
  });

  it("orders clusters by start time", () => {
    const { clusters } = clusterCheckins(pts, CFG);
    expect(clusters[0].startAt).toBeLessThan(clusters[1].startAt);
  });
});
