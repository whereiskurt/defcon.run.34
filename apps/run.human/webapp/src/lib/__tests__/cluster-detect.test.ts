import { describe, it, expect } from "vitest";
import { detectClusters, haversineMeters, type ClusterPoint } from "../cluster-detect";
import { DEFAULT_CLUSTER_CONFIG, tierPoints, normalizeClusterConfig } from "../cluster-config";

/**
 * Fixtures are built around the real scenarios the feature exists for:
 * the morning-run start corral, a social event at the Rebar, and an ad-hoc
 * group at a halfway point — plus the negative controls that keep it honest.
 */

// Roughly the LVCC. 1 deg lat ~ 111_320 m; 1 deg lng at lat 36 ~ 90_000 m.
const BASE_LAT = 36.1147;
const BASE_LNG = -115.1728;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 90_000;

/** Offset from the base point by (north, east) metres. */
function offset(northM: number, eastM: number): { lat: number; lng: number } {
  return {
    lat: BASE_LAT + northM / M_PER_DEG_LAT,
    lng: BASE_LNG + eastM / M_PER_DEG_LNG,
  };
}

/** Wed Aug 5 2026 (a con day) at the given con-local (PDT = UTC-7) time. */
function conDay(dayOfMonth: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 7, dayOfMonth, hour + 7, minute);
}

let seq = 0;
function point(
  userId: string,
  t: number,
  pos: { lat: number; lng: number },
): ClusterPoint {
  seq += 1;
  return { userId, checkInId: `ci-${String(seq).padStart(4, "0")}`, lat: pos.lat, lng: pos.lng, t };
}

/** A group of `n` runners near `centre`, arriving evenly across `spanMin`. */
function group(
  prefix: string,
  n: number,
  startT: number,
  spanMin: number,
  centre: { lat: number; lng: number },
  spreadM: number,
): ClusterPoint[] {
  const out: ClusterPoint[] = [];
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0 : i / (n - 1);
    // Deterministic pseudo-scatter inside the spread radius.
    const angle = i * 2.399963; // golden angle, spreads without clumping
    const r = spreadM * Math.sqrt((i % 7) / 7);
    out.push(
      point(`${prefix}-${i}`, startT + Math.round(frac * spanMin * 60_000), {
        lat: centre.lat + (r * Math.cos(angle)) / M_PER_DEG_LAT,
        lng: centre.lng + (r * Math.sin(angle)) / M_PER_DEG_LNG,
      }),
    );
  }
  return out;
}

const CFG = DEFAULT_CLUSTER_CONFIG;

describe("haversineMeters", () => {
  it("measures a known north offset", () => {
    const a = offset(0, 0);
    const b = offset(100, 0);
    expect(haversineMeters(a.lat, a.lng, b.lat, b.lng)).toBeCloseTo(100, 0);
  });

  it("is zero for the same point", () => {
    expect(haversineMeters(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG)).toBe(0);
  });
});

describe("tierPoints", () => {
  it("pays the highest tier the cluster reaches", () => {
    expect(tierPoints(4, CFG.tiers)).toBe(25);
    expect(tierPoints(7, CFG.tiers)).toBe(25);
    expect(tierPoints(8, CFG.tiers)).toBe(50);
    expect(tierPoints(14, CFG.tiers)).toBe(50);
    expect(tierPoints(15, CFG.tiers)).toBe(100);
    expect(tierPoints(31, CFG.tiers)).toBe(200);
  });

  it("pays nothing below the lowest tier", () => {
    expect(tierPoints(3, CFG.tiers)).toBe(0);
    expect(tierPoints(10, [])).toBe(0);
  });
});

describe("detectClusters — the scenarios this exists for", () => {
  it("finds a Rebar social: 12 runners, 150m, 20 minutes", () => {
    const pts = group("rebar", 12, conDay(5, 21, 40), 20, offset(0, 0), 150);
    const clusters = detectClusters(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(12);
    expect(clusters[0].points).toBe(50);
    expect(clusters[0].day).toBe("2026-08-05");
  });

  it("finds a morning corral: 31 runners trickling in over 40 minutes", () => {
    const pts = group("corral", 31, conDay(5, 6, 12), 40, offset(0, 0), 100);
    const clusters = detectClusters(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(31);
    expect(clusters[0].points).toBe(200);
  });

  it("finds an ad-hoc halfway-point group of 5", () => {
    const pts = group("halfway", 5, conDay(6, 14, 22), 6, offset(0, 0), 60);
    const clusters = detectClusters(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(5);
    expect(clusters[0].points).toBe(25);
  });

  it("holds a group together through 180m of GPS drift", () => {
    const pts = group("drift", 12, conDay(7, 6, 0), 15, offset(0, 0), 180);
    const clusters = detectClusters(pts, CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(12);
  });
});

describe("detectClusters — negative controls", () => {
  it("ignores a group under minRunners", () => {
    const pts = group("small", 3, conDay(5, 12, 0), 5, offset(0, 0), 50);
    expect(detectClusters(pts, CFG)).toEqual([]);
  });

  it("ignores one runner spamming eight check-ins in one place", () => {
    const pts: ClusterPoint[] = [];
    for (let i = 0; i < 8; i++) {
      pts.push(point("lonely", conDay(5, 10, i * 5), offset(0, 0)));
    }
    expect(detectClusters(pts, CFG)).toEqual([]);
  });

  it("ignores a crowd that is not on a con day", () => {
    // Aug 2 2026 — before the con opens.
    const t = Date.UTC(2026, 7, 2, 18, 0);
    const pts = group("early", 20, t, 20, offset(0, 0), 100);
    expect(detectClusters(pts, CFG)).toEqual([]);
  });

  it("does not merge two tight groups 250m apart", () => {
    const pts = [
      ...group("west", 6, conDay(5, 18, 0), 10, offset(0, 0), 30),
      ...group("east", 6, conDay(5, 18, 0), 10, offset(0, 250), 30),
    ];
    const clusters = detectClusters(pts, CFG);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.size)).toEqual([6, 6]);
    // Nobody is counted in both.
    const all = clusters.flatMap((c) => c.members.map((m) => m.userId));
    expect(new Set(all).size).toBe(all.length);
  });

  it("returns nothing when disabled", () => {
    const pts = group("corral", 30, conDay(5, 6, 0), 20, offset(0, 0), 100);
    expect(detectClusters(pts, { ...CFG, enabled: false })).toEqual([]);
  });
});

describe("detectClusters — anti-farm", () => {
  it("collapses a group that re-checks-in 20 minutes later into ONE cluster", () => {
    const centre = offset(0, 0);
    const first = group("farm", 6, conDay(5, 6, 0), 4, centre, 40);
    const second = group("farm", 6, conDay(5, 6, 20), 4, centre, 40);
    // Same six runners, both waves.
    const clusters = detectClusters([...first, ...second], CFG);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(6);
  });

  it("still pays a morning corral AND an evening social on the same day", () => {
    const centre = offset(0, 0);
    const morning = group("both", 6, conDay(5, 6, 0), 10, centre, 40);
    const evening = group("both", 6, conDay(5, 21, 0), 10, centre, 40);
    const clusters = detectClusters([...morning, ...evening], CFG);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.size === 6)).toBe(true);
  });
});

describe("detectClusters — award anchoring and determinism", () => {
  it("anchors each member on their EARLIEST check-in", () => {
    const centre = offset(0, 0);
    const pts = group("anchor", 5, conDay(6, 7, 0), 5, centre, 40);
    const early = pts[0];
    const laterSameUser = point(early.userId, early.t + 8 * 60_000, centre);

    const clusters = detectClusters([...pts, laterSameUser], CFG);
    expect(clusters).toHaveLength(1);

    const member = clusters[0].members.find((m) => m.userId === early.userId);
    expect(member?.checkInId).toBe(early.checkInId);
  });

  it("keeps existing anchors stable when the cluster grows", () => {
    const centre = offset(0, 0);
    const base = group("grow", 6, conDay(6, 6, 0), 10, centre, 60);
    const before = detectClusters(base, CFG);

    const bigger = [...base, ...group("late", 8, conDay(6, 6, 12), 10, centre, 60)];
    const after = detectClusters(bigger, CFG);

    expect(before[0].size).toBe(6);
    expect(before[0].points).toBe(25);
    expect(after[0].size).toBe(14);
    expect(after[0].points).toBe(50);

    // Every original member keeps the SAME anchor check-in — this is what makes
    // the sweep's award upsert idempotent rather than duplicating.
    for (const m of before[0].members) {
      const still = after[0].members.find((x) => x.userId === m.userId);
      expect(still?.checkInId).toBe(m.checkInId);
    }
  });

  it("is order-independent and repeatable", () => {
    const pts = [
      ...group("a", 9, conDay(5, 6, 0), 20, offset(0, 0), 120),
      ...group("b", 5, conDay(5, 19, 0), 10, offset(0, 900), 60),
      ...group("c", 3, conDay(6, 8, 0), 5, offset(900, 0), 40),
    ];
    const forward = detectClusters(pts, CFG);
    const reversed = detectClusters([...pts].reverse(), CFG);

    expect(forward).toEqual(reversed);
    expect(forward).toEqual(detectClusters(pts, CFG));
    expect(forward.map((c) => c.size)).toEqual([9, 5]); // the 3-runner group is under minRunners
  });

  it("orders results by start time", () => {
    const pts = [
      ...group("evening", 6, conDay(5, 21, 0), 10, offset(0, 0), 40),
      ...group("morning", 6, conDay(5, 6, 0), 10, offset(0, 900), 40),
    ];
    const clusters = detectClusters(pts, CFG);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].startAt).toBeLessThan(clusters[1].startAt);
  });
});

describe("detectClusters — config sensitivity", () => {
  it("a tighter radius splits a spread-out crowd", () => {
    const pts = group("spread", 10, conDay(5, 6, 0), 10, offset(0, 0), 190);
    expect(detectClusters(pts, CFG)).toHaveLength(1);

    const tight = normalizeClusterConfig({ ...CFG, radiusMeters: 40 });
    const split = detectClusters(pts, tight);
    // With a 40m radius no single centroid covers ten runners spread over 190m.
    expect(split.every((c) => c.size < 10)).toBe(true);
  });

  it("a shorter window splits a slow trickle", () => {
    const pts = group("trickle", 12, conDay(5, 6, 0), 55, offset(0, 0), 50);
    expect(detectClusters(pts, CFG)[0].size).toBe(12);

    const short = normalizeClusterConfig({ ...CFG, windowMinutes: 10 });
    const split = detectClusters(pts, short);
    expect(split.every((c) => c.size < 12)).toBe(true);
  });

  it("raising minRunners drops the smaller groups", () => {
    const pts = [
      ...group("big", 10, conDay(5, 6, 0), 10, offset(0, 0), 60),
      ...group("small", 5, conDay(5, 19, 0), 10, offset(0, 900), 60),
    ];
    expect(detectClusters(pts, CFG)).toHaveLength(2);

    const strict = normalizeClusterConfig({ ...CFG, minRunners: 8 });
    const only = detectClusters(pts, strict);
    expect(only).toHaveLength(1);
    expect(only[0].size).toBe(10);
  });
});

describe("normalizeClusterConfig", () => {
  it("fills defaults for a missing/empty row", () => {
    expect(normalizeClusterConfig(undefined)).toEqual(DEFAULT_CLUSTER_CONFIG);
    expect(normalizeClusterConfig({})).toEqual(DEFAULT_CLUSTER_CONFIG);
  });

  it("clamps out-of-range knobs instead of throwing", () => {
    const c = normalizeClusterConfig({
      radiusMeters: 99_999, windowMinutes: 0, minRunners: 1, maxPerUserPerDay: 900,
    });
    expect(c.radiusMeters).toBe(5_000);
    expect(c.windowMinutes).toBe(1);
    expect(c.minRunners).toBe(2);
    expect(c.maxPerUserPerDay).toBe(50);
  });

  it("sorts and de-duplicates the tier table", () => {
    const c = normalizeClusterConfig({
      tiers: [
        { minRunners: 15, points: 100 },
        { minRunners: 4, points: 25 },
        { minRunners: 4, points: 30 }, // later wins
        { minRunners: -2, points: 5 }, // dropped
        { minRunners: 8, points: "nope" }, // dropped
      ],
    });
    expect(c.tiers).toEqual([
      { minRunners: 4, points: 30 },
      { minRunners: 15, points: 100 },
    ]);
  });

  it("accepts an explicitly empty tier table", () => {
    expect(normalizeClusterConfig({ tiers: [] }).tiers).toEqual([]);
  });
});
