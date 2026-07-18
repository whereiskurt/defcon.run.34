import { describe, expect, it } from "vitest";

import { mergeSolveLedgers, scoreEventToSolve } from "./ctf-solve-merge";

/**
 * The admin leaderboard historically read CtfSolve rows ONLY, so a solve that
 * the judge records as a CtfScoreEvent (OTP / wordlist / repeatable flags) was
 * invisible in the drills, tiles, channels, and first-blood counts — even though
 * the RunUser-backed standings scored it correctly. These pure helpers normalize
 * a CtfScoreEvent into the CtfSolve view and union the two ledgers.
 */
describe("scoreEventToSolve", () => {
  it("maps scoredAt→solvedAt and carries points/channel, with no ordinal/firstBlood", () => {
    const solve = scoreEventToSolve({
      challenge: "didhtp1",
      user: "u1",
      bucket: "b1",
      points: 100,
      channel: "qr",
      scoredAt: "2026-07-18T01:27:00.000Z",
    } as never);

    expect(solve.challenge).toBe("didhtp1");
    expect(solve.user).toBe("u1");
    expect(solve.points).toBe(100);
    expect(solve.channel).toBe("qr");
    expect(solve.solvedAt).toBe("2026-07-18T01:27:00.000Z");
    // Score events carry no gap-free ordinal and no first-blood marker.
    expect(solve.ordinal).toBeUndefined();
    expect(solve.firstBlood).toBeFalsy();
  });
});

describe("mergeSolveLedgers", () => {
  it("unions CtfSolve rows with normalized CtfScoreEvent rows", () => {
    const solves = [
      {
        challenge: "static1",
        user: "u1",
        points: 10,
        ordinal: 1,
        channel: "covert",
        firstBlood: true,
        solvedAt: "2026-07-15T00:00:00.000Z",
      },
    ];
    const events = [
      {
        challenge: "didhtp1",
        user: "u1",
        bucket: "b1",
        points: 100,
        channel: "qr",
        scoredAt: "2026-07-18T01:27:00.000Z",
      },
    ];

    const merged = mergeSolveLedgers(solves as never, events as never);

    expect(merged).toHaveLength(2);
    const otp = merged.find((m) => m.challenge === "didhtp1");
    expect(otp?.points).toBe(100);
    expect(otp?.solvedAt).toBe("2026-07-18T01:27:00.000Z");
    const stat = merged.find((m) => m.challenge === "static1");
    expect(stat?.firstBlood).toBe(true);
    expect(stat?.ordinal).toBe(1);
  });

  it("surfaces a runner whose only solves are CtfScoreEvents (the KPH/didhtp1 regression)", () => {
    const merged = mergeSolveLedgers(
      [] as never,
      [
        {
          challenge: "didhtp1",
          user: "kph",
          bucket: "b",
          points: 100,
          channel: "qr",
          scoredAt: "2026-07-18T01:27:00.000Z",
        },
      ] as never
    );

    const kph = merged.filter((m) => m.user === "kph");
    expect(kph).toHaveLength(1);
    expect(kph[0].points).toBe(100);
  });

  it("keeps every event of a repeatable flag as its own solve row", () => {
    const merged = mergeSolveLedgers(
      [] as never,
      [
        { challenge: "didhtp1", user: "u1", bucket: "w1", points: 100, channel: "qr", scoredAt: "2026-07-18T01:00:00.000Z" },
        { challenge: "didhtp1", user: "u1", bucket: "w2", points: 100, channel: "qr", scoredAt: "2026-07-19T01:00:00.000Z" },
      ] as never
    );

    expect(merged.filter((m) => m.user === "u1" && m.challenge === "didhtp1")).toHaveLength(2);
  });
});
