import { describe, it, expect } from "vitest";
import {
  POINTS,
  globalScore,
  totalCount,
  rankComparator,
  type ScorableUser,
} from "./leaderboard-scoring";

/**
 * Unit tests for the pure leaderboard scoring module (LDBR-03 / LDBR-12).
 * These prove the read-time scoring invariants the Phase 51 leaderboard relies
 * on WITHOUT any DynamoDB, network, or CTF-judge coupling:
 *   - globalScore = activityScore + ctfScore, degrading to activityScore when
 *     ctfScore is unset (SC #2);
 *   - the DC33 rank comparator order across every tie level (SC #3);
 *   - POINTS is the single source of truth and carries no ctf/qr key (SC #4,
 *     read side) — CTF enters only via the read-time sum, never as a source.
 */

function su(over: Partial<ScorableUser>): ScorableUser {
  return {
    activityScore: 0,
    activityCounts: { checkin: 0, gpx: 0 },
    latestActivityAt: 0,
    createdAt: 0,
    ctfScore: 0,
    ctfSolves: 0,
    ...over,
  };
}

describe("globalScore", () => {
  it("sums activityScore + ctfScore", () => {
    expect(globalScore({ activityScore: 3, ctfScore: 2 })).toBe(5);
  });

  it("degrades to activityScore when ctfScore is unset (SC #2)", () => {
    expect(globalScore({ activityScore: 3 })).toBe(3);
  });

  it("reads an empty row as 0 (never NaN/throw)", () => {
    expect(globalScore({})).toBe(0);
  });
});

describe("POINTS", () => {
  it("is the single source of truth { checkin, gpx, strava }", () => {
    expect(POINTS).toEqual({ checkin: 1, gpx: 1, strava: 1 });
  });

  it("has no ctf/qr key (SC #4, read side)", () => {
    expect("ctf" in POINTS).toBe(false);
    expect("qr" in POINTS).toBe(false);
  });
});

describe("totalCount", () => {
  it("sums activity counts + ctfSolves", () => {
    expect(
      totalCount({ activityCounts: { checkin: 2, gpx: 1 }, ctfSolves: 3 })
    ).toBe(6);
  });

  it("sums checkin + gpx + strava counts + ctfSolves", () => {
    expect(
      totalCount({ activityCounts: { checkin: 1, gpx: 2, strava: 3 } })
    ).toBe(6);
  });

  it("reads an empty row as 0", () => {
    expect(totalCount({})).toBe(0);
  });
});

describe("rankComparator (DC33 order, SC #3)", () => {
  it("orders by globalScore desc first", () => {
    const rows = [
      su({ createdAt: 1, activityScore: 1 }),
      su({ createdAt: 2, activityScore: 5, ctfScore: 0 }),
      su({ createdAt: 3, activityScore: 2, ctfScore: 1 }),
    ];
    // scores: r0=1, r1=5, r2=3
    expect(rows.slice().sort(rankComparator).map((r) => r.createdAt)).toEqual([
      2, 3, 1,
    ]);
  });

  it("breaks a globalScore tie by higher totalCount", () => {
    const rows = [
      su({ createdAt: 1, activityScore: 4, activityCounts: { checkin: 1, gpx: 0 } }),
      su({ createdAt: 2, activityScore: 4, activityCounts: { checkin: 3, gpx: 2 } }),
    ];
    expect(rows.slice().sort(rankComparator).map((r) => r.createdAt)).toEqual([
      2, 1,
    ]);
  });

  it("breaks a score+count tie by more recent latestActivityAt", () => {
    const rows = [
      su({
        createdAt: 1,
        activityScore: 4,
        activityCounts: { checkin: 2, gpx: 0 },
        latestActivityAt: 100,
      }),
      su({
        createdAt: 2,
        activityScore: 4,
        activityCounts: { checkin: 2, gpx: 0 },
        latestActivityAt: 900,
      }),
    ];
    expect(rows.slice().sort(rankComparator).map((r) => r.createdAt)).toEqual([
      2, 1,
    ]);
  });

  it("breaks a full tie by older createdAt (lower first)", () => {
    const rows = [
      su({
        createdAt: 900,
        activityScore: 4,
        activityCounts: { checkin: 2, gpx: 0 },
        latestActivityAt: 100,
      }),
      su({
        createdAt: 100,
        activityScore: 4,
        activityCounts: { checkin: 2, gpx: 0 },
        latestActivityAt: 100,
      }),
    ];
    expect(rows.slice().sort(rankComparator).map((r) => r.createdAt)).toEqual([
      100, 900,
    ]);
  });

  it("resolves a full four-level tie cascade in order", () => {
    // A: top score. B/C: equal score, C higher count. D/E: equal score+count,
    // E more recent. F/G: full tie, F older createdAt.
    const A = su({ createdAt: 1, activityScore: 10 });
    const B = su({ createdAt: 2, activityScore: 5, activityCounts: { checkin: 1, gpx: 0 } });
    const C = su({ createdAt: 3, activityScore: 5, activityCounts: { checkin: 4, gpx: 0 } });
    const D = su({ createdAt: 4, activityScore: 3, activityCounts: { checkin: 1, gpx: 0 }, latestActivityAt: 50 });
    const E = su({ createdAt: 5, activityScore: 3, activityCounts: { checkin: 1, gpx: 0 }, latestActivityAt: 99 });
    const F = su({ createdAt: 60, activityScore: 1, activityCounts: { checkin: 0, gpx: 0 }, latestActivityAt: 10 });
    const G = su({ createdAt: 70, activityScore: 1, activityCounts: { checkin: 0, gpx: 0 }, latestActivityAt: 10 });
    const sorted = [G, F, E, D, C, B, A].sort(rankComparator);
    expect(sorted.map((r) => r.createdAt)).toEqual([1, 3, 2, 5, 4, 60, 70]);
  });
});
