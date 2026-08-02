import { describe, it, expect } from "vitest";
// The PURE scenario module — importing `cluster-demo` here would drag the
// entity layer (and its AWS client) into a test that needs none of it.
import {
  buildDemoCheckIns,
  demoRoster,
  demoUserId,
  DEMO_SCENARIOS,
} from "../cluster-demo-data";
import { detectClusters, type ClusterPoint } from "../cluster-detect";
import { DEFAULT_CLUSTER_CONFIG } from "../cluster-config";
import { computeUserScore } from "../scoring-engine";
import { conLocalDate, isConDay } from "../con-days";

/**
 * The demo data is what the admin "Load demo clusters" button writes, so these
 * tests pin the SCENARIOS themselves: run the seeded check-ins through the real
 * detector and assert the awards a sweep would produce. If a config default or
 * the detector changes shape, this fails before anyone clicks the button.
 */

const points: ClusterPoint[] = buildDemoCheckIns().map((c) => ({
  userId: c.userId,
  checkInId: c.checkInId,
  lat: c.lat,
  lng: c.lng,
  t: c.timestamp,
}));

const clusters = detectClusters(points, DEFAULT_CLUSTER_CONFIG);

describe("demo data shape", () => {
  it("is deterministic across calls", () => {
    expect(buildDemoCheckIns()).toEqual(buildDemoCheckIns());
  });

  it("lands every check-in on a con day", () => {
    for (const c of buildDemoCheckIns()) {
      expect(isConDay(conLocalDate(c.timestamp))).toBe(true);
    }
  });

  it("uses unique check-in ids", () => {
    const ids = buildDemoCheckIns().map((c) => c.checkInId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rosters every runner named by a scenario, exactly once", () => {
    const roster = demoRoster();
    expect(new Set(roster.map((r) => r.userId)).size).toBe(roster.length);

    // Derived from the scenarios rather than hardcoded — the ranges overlap and
    // skip (32-36 are unused), so a literal count would silently drift.
    const expected = new Set<number>();
    for (const s of DEMO_SCENARIOS) {
      for (let n = s.runners[0]; n <= s.runners[1]; n++) expected.add(n);
    }
    expect(roster.length).toBe(expected.size);
    expect(new Set(roster.map((r) => r.userId))).toEqual(
      new Set([...expected].map(demoUserId)),
    );
  });

  it("keeps roughly half the check-ins private, proving privacy is not required", () => {
    const rows = buildDemoCheckIns();
    const priv = rows.filter((c) => c.isPrivate).length;
    expect(priv).toBeGreaterThan(0);
    expect(priv).toBeLessThan(rows.length);
  });
});

describe("demo data produces the intended clusters", () => {
  it("finds exactly the eight positive scenarios", () => {
    expect(clusters).toHaveLength(8);
  });

  it("scores the two morning corrals at the top tier", () => {
    const corrals = clusters.filter((c) => c.size >= 25);
    expect(corrals).toHaveLength(2);
    expect(corrals.map((c) => c.size).sort((a, b) => a - b)).toEqual([27, 31]);
    expect(corrals.every((c) => c.points === 200)).toBe(true);
  });

  it("scores the Rebar social at the 8+ tier", () => {
    const rebar = clusters.find((c) => c.size === 12);
    expect(rebar?.points).toBe(50);
    expect(rebar?.day).toBe("2026-08-05");
  });

  it("scores the halfway-point group at the entry tier", () => {
    const small = clusters.filter((c) => c.size === 5);
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(small.every((c) => c.points === 25)).toBe(true);
  });

  it("keeps the two Friday groups 250m apart separate", () => {
    const friday = clusters.filter((c) => c.day === "2026-08-07");
    expect(friday).toHaveLength(2);
    expect(friday.every((c) => c.size === 6)).toBe(true);

    const members = friday.flatMap((c) => c.members.map((m) => m.userId));
    expect(new Set(members).size).toBe(members.length);
  });

  it("awards nothing on Saturday — both negative controls hold", () => {
    expect(clusters.filter((c) => c.day === "2026-08-08")).toEqual([]);
  });

  it("never awards the lone spammer or the group of three", () => {
    const awarded = new Set(clusters.flatMap((c) => c.members.map((m) => m.userId)));
    for (const n of [37, 38, 39, 40]) {
      expect(awarded.has(demoUserId(n))).toBe(false);
    }
  });
});

describe("demo data exercises the per-day cap", () => {
  const awardsFor = (userId: string) =>
    clusters
      .filter((c) => c.members.some((m) => m.userId === userId))
      .map((c) => ({ points: c.points, startAt: c.startAt }));

  it("puts runner 1 in four clusters on Wednesday", () => {
    const wed = awardsFor(demoUserId(1)).filter(
      (a) => conLocalDate(a.startAt) === "2026-08-05",
    );
    expect(wed).toHaveLength(4);
  });

  it("caps runner 1's Wednesday at the best three", () => {
    const awards = awardsFor(demoUserId(1));
    const score = computeUserScore({
      accomplishments: [],
      solves: [],
      events: [],
      configs: new Map(),
      clusterAwards: awards,
      clusterCap: 3,
    });

    // Wed: 200 (corral) + 50 (lunch) + 50 (rebar) — the 25pt shakeout is dropped.
    // Thu: 25 (halfway). Fri: 25 (split west).
    const wedBest = 200 + 50 + 50;
    expect(score.breakdown.clusterBonus).toBe(wedBest + 25 + 25);
  });

  it("shows the cap actually binding — raising it pays more", () => {
    const awards = awardsFor(demoUserId(1));
    const capped = computeUserScore({
      accomplishments: [], solves: [], events: [], configs: new Map(),
      clusterAwards: awards, clusterCap: 3,
    }).breakdown.clusterBonus;
    const uncapped = computeUserScore({
      accomplishments: [], solves: [], events: [], configs: new Map(),
      clusterAwards: awards, clusterCap: 10,
    }).breakdown.clusterBonus;

    expect(uncapped - capped).toBe(25);
  });
});

describe("scenario metadata", () => {
  it("gives every scenario a unique key and a stated expectation", () => {
    const keys = DEMO_SCENARIOS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEMO_SCENARIOS.every((s) => s.expectation.length > 0)).toBe(true);
  });
});
