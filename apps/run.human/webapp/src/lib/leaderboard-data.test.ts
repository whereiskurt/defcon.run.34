import { describe, it, expect } from "vitest";
import {
  buildLeaderboard,
  isStale,
  LEADERBOARD_CACHE_TTL_MS,
  type LeaderboardUser,
} from "./leaderboard-data";

/**
 * Pure-core unit tests for the leaderboard ranking + cache-staleness primitives
 * (LDBR-07, Phase 51). No DynamoDB, no mocks — every invariant is proven over
 * plain fixture rows:
 *   - globalRank is assigned over the FULL sorted set BEFORE filter/paginate
 *     (rank stable under filter — SC #2, threat T-51-02),
 *   - globalScore degrades to activityScore when ctfScore is absent (SC #2),
 *   - pagination math + defaults (page 1, limit 25),
 *   - the row DTO is lean and carries NO PII (threat T-51-01),
 *   - isStale honors the strictly-greater 60s boundary (SC #3 core).
 *
 * Mirrors the pure-helper convention in admin-report.test.ts.
 */

function row(over: Partial<LeaderboardUser>): LeaderboardUser {
  return {
    userId: "u",
    displayName: "",
    mqttUsertype: "rabbit",
    activityScore: 0,
    activityCounts: { checkin: 0, gpx: 0 },
    latestActivityAt: 0,
    createdAt: 0,
    ...over,
  };
}

describe("buildLeaderboard — ranking order", () => {
  it("assigns globalRank 1..N in rankComparator order (score desc)", () => {
    const users = [
      row({ userId: "b", displayName: "Bravo", activityScore: 20 }),
      row({ userId: "a", displayName: "Alpha", activityScore: 30 }),
      row({ userId: "c", displayName: "Charlie", activityScore: 10 }),
    ];
    const { rows } = buildLeaderboard(users);
    expect(rows.map((r) => [r.userId, r.globalRank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("delegates tie-breaks to leaderboard-scoring's rankComparator (count → latest → createdAt)", () => {
    // Equal globalScore=10 → resolved by totalCount desc, then latestActivityAt
    // desc, then createdAt asc. Proves it reuses rankComparator, not a re-sort.
    const users = [
      // score 10, count 1, latest 100, created 5
      row({ userId: "late", activityScore: 10, activityCounts: { checkin: 1, gpx: 0 }, latestActivityAt: 100, createdAt: 5 }),
      // score 10, count 2 (wins on count) → rank 1
      row({ userId: "count", activityScore: 10, activityCounts: { checkin: 1, gpx: 1 }, latestActivityAt: 50, createdAt: 9 }),
      // score 10, count 1, latest 100, created 1 (older account beats "late") → rank 2
      row({ userId: "older", activityScore: 10, activityCounts: { checkin: 1, gpx: 0 }, latestActivityAt: 100, createdAt: 1 }),
    ];
    const { rows } = buildLeaderboard(users);
    expect(rows.map((r) => r.userId)).toEqual(["count", "older", "late"]);
    expect(rows.map((r) => r.globalRank)).toEqual([1, 2, 3]);
  });
});

describe("buildLeaderboard — ctfScore-absent degrade (SC #2)", () => {
  it("degrades globalScore to activityScore when ctfScore is absent, sums when present", () => {
    const users = [
      // activity 10 + ctf 25 = 35 → rank 1
      row({ userId: "ctf", activityScore: 10, ctfScore: 25 }),
      // activity 20, ctf absent → globalScore 20 → rank 2
      row({ userId: "noctf", activityScore: 20 }),
    ];
    const { rows } = buildLeaderboard(users);
    const byId = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(byId["ctf"].globalScore).toBe(35);
    expect(byId["noctf"].globalScore).toBe(20);
    expect(rows.map((r) => r.userId)).toEqual(["ctf", "noctf"]);
  });
});

describe("buildLeaderboard — rank stable under filter (SC #2 headline / T-51-02)", () => {
  it("returns C at its TRUE global rank 3 when the filter matches only C", () => {
    const users = [
      row({ userId: "a", displayName: "Alpha", activityScore: 30 }),
      row({ userId: "b", displayName: "Bravo", activityScore: 20 }),
      row({ userId: "c", displayName: "Charlie", activityScore: 10 }),
    ];
    const { rows, total } = buildLeaderboard(users, { filter: "charlie" });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("c");
    expect(rows[0].globalRank).toBe(3);
    expect(total).toBe(1);
  });

  it("filters case-insensitively on displayName contains", () => {
    const users = [
      row({ userId: "a", displayName: "Alpha Runner", activityScore: 30 }),
      row({ userId: "b", displayName: "Bravo", activityScore: 20 }),
    ];
    const { rows } = buildLeaderboard(users, { filter: "RUN" });
    expect(rows.map((r) => r.userId)).toEqual(["a"]);
  });
});

describe("buildLeaderboard — pagination", () => {
  const users = [
    row({ userId: "a", displayName: "A", activityScore: 50 }),
    row({ userId: "b", displayName: "B", activityScore: 40 }),
    row({ userId: "c", displayName: "C", activityScore: 30 }),
    row({ userId: "d", displayName: "D", activityScore: 20 }),
    row({ userId: "e", displayName: "E", activityScore: 10 }),
  ];

  it("returns the page-2/limit-2 slice (global ranks 3 and 4)", () => {
    const { rows, total, page, limit } = buildLeaderboard(users, { page: 2, limit: 2 });
    expect(rows.map((r) => r.userId)).toEqual(["c", "d"]);
    expect(rows.map((r) => r.globalRank)).toEqual([3, 4]);
    expect(total).toBe(5);
    expect(page).toBe(2);
    expect(limit).toBe(2);
  });

  it("defaults to page 1, limit 25 with no opts", () => {
    const { rows, page, limit } = buildLeaderboard(users);
    expect(page).toBe(1);
    expect(limit).toBe(25);
    expect(rows).toHaveLength(5);
    expect(rows[0].globalRank).toBe(1);
  });
});

describe("buildLeaderboard — ctfSolves chip", () => {
  it("surfaces ctfSolves when set and 0 (never undefined/NaN) when absent", () => {
    const users = [
      row({ userId: "solver", activityScore: 10, ctfSolves: 4 }),
      row({ userId: "none", activityScore: 5 }),
    ];
    const { rows } = buildLeaderboard(users);
    const byId = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(byId["solver"].ctfSolves).toBe(4);
    expect(byId["none"].ctfSolves).toBe(0);
    expect(Number.isNaN(byId["none"].ctfSolves)).toBe(false);
  });
});

describe("buildLeaderboard — row DTO leanness (no PII, T-51-01)", () => {
  it("exposes only the lean board fields and no email/PII", () => {
    const users = [
      row({ userId: "u1", displayName: "Runner", mqttUsertype: "og", activityScore: 12, activityCounts: { checkin: 3, gpx: 2 }, ctfSolves: 1 }),
    ];
    const { rows } = buildLeaderboard(users);
    const r = rows[0];
    expect(Object.keys(r).sort()).toEqual(
      ["activityCounts", "ctfSolves", "displayName", "globalRank", "globalScore", "mqttUsertype", "userId"].sort()
    );
    expect(r.activityCounts).toEqual({ checkin: 3, gpx: 2 });
    expect(r).not.toHaveProperty("email");
    expect(r).not.toHaveProperty("emailFull");
    expect(r).not.toHaveProperty("hash");
  });

  it("normalizes activityCounts to zero-filled checkin/gpx", () => {
    const users = [row({ userId: "u1", displayName: "R", activityCounts: undefined })];
    const { rows } = buildLeaderboard(users);
    expect(rows[0].activityCounts).toEqual({ checkin: 0, gpx: 0 });
  });

  it("does not mutate the input array", () => {
    const users = [
      row({ userId: "a", activityScore: 10 }),
      row({ userId: "b", activityScore: 20 }),
    ];
    buildLeaderboard(users);
    expect(users.map((u) => u.userId)).toEqual(["a", "b"]);
  });
});

describe("isStale / LEADERBOARD_CACHE_TTL_MS (SC #3 core)", () => {
  it("has a 60s named TTL constant", () => {
    expect(LEADERBOARD_CACHE_TTL_MS).toBe(60_000);
  });

  it("is fresh at the exact fetch time", () => {
    expect(isStale(1_000_000, 1_000_000)).toBe(false);
  });

  it("is stale one ms past the TTL", () => {
    const now = 1_000_000;
    expect(isStale(now, now - 60_001)).toBe(true);
  });

  it("is still fresh at exactly the TTL boundary (strictly greater)", () => {
    const now = 1_000_000;
    expect(isStale(now, now - 60_000)).toBe(false);
  });
});
