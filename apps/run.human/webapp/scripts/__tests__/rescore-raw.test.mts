import { describe, it, expect } from "vitest";
import { rescoreUserRaw } from "../rescore-raw.mjs";

/**
 * The operator reset scripts (reset-ctf-user / reset-social-user) delete part of
 * ONE user's ledger and must then re-derive that user's score. Before the
 * points-consistency migration they just zeroed the legacy `ctfScore` field,
 * which nothing writes or reads any more — so the reset was cosmetic and the
 * player kept their points. These tests pin the two things that must hold:
 *   1. the derived score is actually rewritten from the REMAINING ledger, and
 *   2. the non-CTF slices (run streak, cluster bonus) SURVIVE a CTF wipe —
 *      a blanket zero would silently strip a runner's legitimate run points.
 */

/** Minimal DynamoDBDocument stand-in: canned scans + captured updates. */
function fakeDoc(rowsByEntity: Record<string, any[]>) {
  const updates: any[] = [];
  return {
    updates,
    async scan(params: any) {
      // Route on the entity marker the scripts filter by.
      const vals = params.ExpressionAttributeValues ?? {};
      const wanted = Object.entries(vals).find(([k]) => k !== ":u" && k !== ":user")?.[1];
      return { Items: rowsByEntity[String(wanted)] ?? [], LastEvaluatedKey: undefined };
    },
    async update(params: any) {
      updates.push(params);
      return {};
    },
  };
}

const CON_DAY_1 = Date.parse("2026-08-06T12:00:00-07:00");
const CON_DAY_2 = Date.parse("2026-08-07T12:00:00-07:00");

describe("rescoreUserRaw", () => {
  it("preserves run + cluster points when the CTF ledger is emptied", async () => {
    const doc = fakeDoc({
      RunUser: [{ pk: "p", sk: "s", userId: "u1" }],
      Accomplishment: [
        { userId: "u1", source: "gpx", completedAt: CON_DAY_1 },
        { userId: "u1", source: "checkin", completedAt: CON_DAY_2 },
      ],
      CtfSolve: [], // wiped by the reset
      CtfScoreEvent: [], // wiped by the reset
      Ctf: [],
      ClusterAward: [{ userId: "u1", points: 40, startAt: CON_DAY_1 }],
      ClusterConfig: [],
    });

    const result = await rescoreUserRaw(doc as any, "tbl", "u1", { confirm: true });

    expect(result.breakdown.ctfStreak).toBe(0);
    expect(result.breakdown.flagPoints).toBe(0);
    // The whole point: these did NOT get zeroed.
    expect(result.breakdown.runStreak).toBeGreaterThan(0);
    expect(result.breakdown.clusterBonus).toBe(40);
    expect(result.score).toBe(result.breakdown.runStreak + 40);
  });

  it("writes the derived fields (not the legacy ctfScore) on confirm", async () => {
    const doc = fakeDoc({
      RunUser: [{ pk: "p", sk: "s", userId: "u1" }],
      Accomplishment: [],
      CtfSolve: [],
      CtfScoreEvent: [],
      Ctf: [],
      ClusterAward: [],
      ClusterConfig: [],
    });

    await rescoreUserRaw(doc as any, "tbl", "u1", { confirm: true });

    expect(doc.updates).toHaveLength(1);
    const expr = doc.updates[0].UpdateExpression as string;
    expect(expr).toContain("score");
    expect(expr).toContain("scoreBreakdown");
    expect(expr).toContain("streakDays");
    expect(expr).toContain("ctfSolves");
    expect(expr).toContain("rescoredAt");
    expect(expr).not.toContain("ctfScore");
  });

  it("writes NOTHING in dry-run but still reports the computed score", async () => {
    const doc = fakeDoc({
      RunUser: [{ pk: "p", sk: "s", userId: "u1" }],
      Accomplishment: [{ userId: "u1", source: "gpx", completedAt: CON_DAY_1 }],
      CtfSolve: [],
      CtfScoreEvent: [],
      Ctf: [],
      ClusterAward: [],
      ClusterConfig: [],
    });

    const result = await rescoreUserRaw(doc as any, "tbl", "u1", { confirm: false });

    expect(doc.updates).toHaveLength(0);
    expect(result.breakdown.runStreak).toBeGreaterThan(0);
  });

  it("counts surviving CTF rows — a PARTIAL wipe keeps the rest", async () => {
    const doc = fakeDoc({
      RunUser: [{ pk: "p", sk: "s", userId: "u1" }],
      Accomplishment: [],
      CtfSolve: [{ user: "u1", challenge: "keep", ordinal: 1, solvedAt: "2026-08-06T19:00:00Z" }],
      CtfScoreEvent: [],
      // maxSolves is REQUIRED for a non-zero valuation: computePoints returns
      // 0 (or the floor) as soon as ordinal > maxSolves, so a config fixture
      // without it values every solve at 0 and hides real regressions.
      Ctf: [{ challenge: "keep", pointMax: 100, pointFloor: 50, maxSolves: 10 }],
      ClusterAward: [],
      ClusterConfig: [],
    });

    const result = await rescoreUserRaw(doc as any, "tbl", "u1", { confirm: true });

    expect(result.counts.solves).toBe(1);
    expect(result.breakdown.flagPoints).toBeGreaterThan(0);
  });
});
