import { describe, it, expect } from "vitest";
import { diffAwards, toDesiredAwards, conRange, type DesiredAward } from "../cluster-sweep";
import { conLocalDate } from "../con-days";
import type { DetectedCluster } from "../cluster-detect";

function award(over: Partial<DesiredAward> = {}): DesiredAward {
  return {
    userId: "u1",
    anchorCheckInId: "ci-1",
    clusterId: "abc123",
    day: "2026-08-05",
    size: 8,
    points: 50,
    centroidLat: 36.1147,
    centroidLng: -115.1728,
    startAt: 1_770_000_000_000,
    endAt: 1_770_000_600_000,
    ...over,
  };
}

describe("conRange", () => {
  it("spans the first con day to the last, con-local", () => {
    const { since, until } = conRange();
    expect(conLocalDate(since)).toBe("2026-08-05");
    expect(conLocalDate(until)).toBe("2026-08-10");
    expect(since).toBeLessThan(until);
  });
});

describe("toDesiredAwards", () => {
  it("emits one row per member, all at the cluster's tier", () => {
    const cluster: DetectedCluster = {
      clusterId: "c1",
      day: "2026-08-05",
      centroidLat: 36.1,
      centroidLng: -115.1,
      startAt: 100,
      endAt: 200,
      size: 3,
      points: 25,
      members: [
        { userId: "a", checkInId: "ci-a", t: 100 },
        { userId: "b", checkInId: "ci-b", t: 150 },
        { userId: "c", checkInId: "ci-c", t: 200 },
      ],
    };

    const rows = toDesiredAwards([cluster]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.userId)).toEqual(["a", "b", "c"]);
    expect(rows.every((r) => r.points === 25 && r.size === 3)).toBe(true);
    expect(rows.map((r) => r.anchorCheckInId)).toEqual(["ci-a", "ci-b", "ci-c"]);
  });
});

describe("diffAwards", () => {
  it("writes brand-new awards", () => {
    const { puts, deletes } = diffAwards([award()], []);
    expect(puts).toHaveLength(1);
    expect(deletes).toEqual([]);
  });

  it("is a no-op when nothing changed", () => {
    const a = award();
    const { puts, deletes } = diffAwards([a], [a]);
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("upgrades a member when their cluster grew", () => {
    const before = award({ size: 6, points: 25, clusterId: "old" });
    const after = award({ size: 14, points: 50, clusterId: "new" });

    const { puts, deletes } = diffAwards([after], [before]);
    expect(puts).toEqual([after]);
    expect(deletes).toEqual([]);
  });

  it("downgrades a member when the cluster shrank under a retune", () => {
    const before = award({ size: 20, points: 100, clusterId: "big" });
    const after = award({ size: 5, points: 25, clusterId: "small" });

    const { puts } = diffAwards([after], [before]);
    expect(puts[0].points).toBe(25);
  });

  it("deletes an award whose cluster dissolved", () => {
    const stale = award({ userId: "gone", anchorCheckInId: "ci-9" });
    const { puts, deletes } = diffAwards([], [stale]);

    expect(puts).toEqual([]);
    expect(deletes).toEqual([{ userId: "gone", anchorCheckInId: "ci-9" }]);
  });

  it("separates runners who share an anchor id across different users", () => {
    const a = award({ userId: "a", anchorCheckInId: "shared" });
    const b = award({ userId: "b", anchorCheckInId: "shared" });

    const { puts, deletes } = diffAwards([a, b], [a]);
    expect(puts).toEqual([b]);
    expect(deletes).toEqual([]);
  });

  it("handles a mixed sweep: one new, one changed, one stale, one untouched", () => {
    const untouched = award({ userId: "same", anchorCheckInId: "ci-same" });
    const changedBefore = award({ userId: "up", anchorCheckInId: "ci-up", points: 25, size: 5 });
    const changedAfter = award({ userId: "up", anchorCheckInId: "ci-up", points: 100, size: 16 });
    const stale = award({ userId: "old", anchorCheckInId: "ci-old" });
    const fresh = award({ userId: "new", anchorCheckInId: "ci-new" });

    const { puts, deletes } = diffAwards(
      [untouched, changedAfter, fresh],
      [untouched, changedBefore, stale],
    );

    expect(puts.map((p) => p.userId).sort()).toEqual(["new", "up"]);
    expect(deletes).toEqual([{ userId: "old", anchorCheckInId: "ci-old" }]);
  });

  it("treats a missing points field on an existing row as changed", () => {
    const existing = { userId: "u1", anchorCheckInId: "ci-1", clusterId: "abc123", startAt: 1_770_000_000_000 };
    const { puts } = diffAwards([award()], [existing]);
    expect(puts).toHaveLength(1);
  });
});
