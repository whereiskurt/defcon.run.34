import { describe, it, expect } from "vitest";
import { computeUserScore } from "../scoring-engine";

const cfg = (over = {}) => ({
  challenge: "x", pointMax: 100, pointFloor: 100, maxSolves: 100000,
  firstBloodBonus: 0, ...over,
});
const noon = (d: string) => Date.parse(`${d}T19:00:00Z`); // noon PDT

describe("computeUserScore", () => {
  it("empty ledger scores 0", () => {
    const r = computeUserScore({ accomplishments: [], solves: [], events: [], configs: new Map() });
    expect(r.score).toBe(0);
    expect(r.days).toEqual({ run: 0, social: 0, ctf: 0 });
    expect(r.latestActivityAt).toBeUndefined();
  });

  it("run streak is total-by-streak over distinct con days; check-ins light days", () => {
    const r = computeUserScore({
      accomplishments: [
        { source: "gpx", completedAt: noon("2026-08-06") },
        { source: "gpx", completedAt: noon("2026-08-06") },      // same day, no extra
        { source: "checkin", completedAt: noon("2026-08-07") },   // check-in lights
        { source: "strava", completedAt: noon("2026-07-01") },    // not a con day
      ],
      solves: [], events: [], configs: new Map(),
    });
    expect(r.days.run).toBe(2);
    expect(r.breakdown.runStreak).toBe(50);
    expect(r.score).toBe(50);
    expect(r.counts).toMatchObject({ checkin: 1, gpx: 2, strava: 1 });
  });

  it("social days come from social-scan buckets and are worth 0 per scan", () => {
    const r = computeUserScore({
      accomplishments: [], solves: [],
      events: [
        { challenge: "social-scan", bucket: "2026-08-05#a#b", scoredAt: "2026-08-05T20:00:00Z" },
        { challenge: "social-scan", bucket: "2026-08-05#a#c", scoredAt: "2026-08-05T21:00:00Z" }, // same day
        { challenge: "social-scan", bucket: "2026-08-08#a#d", scoredAt: "2026-08-08T20:00:00Z" },
      ],
      configs: new Map(),
    });
    expect(r.days.social).toBe(2);
    expect(r.breakdown.socialStreak).toBe(50);
    expect(r.breakdown.flagPoints).toBe(0);
    expect(r.counts.solves).toBe(0); // social-scan rows are not flag solves
  });

  it("flag points re-value from ordinal against CURRENT config; missing config = 0", () => {
    const configs = new Map([
      ["phone", cfg({ challenge: "phone", pointMax: 200, pointFloor: 100, maxSolves: 25, floorAfterMax: true })],
    ]);
    const r = computeUserScore({
      accomplishments: [],
      solves: [
        { challenge: "phone", ordinal: 1, solvedAt: "2026-08-06T19:00:00Z" },
        { challenge: "deleted-flag", ordinal: 1, solvedAt: "2026-08-06T20:00:00Z" },
      ],
      events: [], configs,
    });
    expect(r.breakdown.flagPoints).toBe(200);
    expect(r.days.ctf).toBe(1);           // both solves same con day
    expect(r.breakdown.ctfStreak).toBe(25);
    expect(r.score).toBe(225);
  });

  it("legacy event rows without ordinal value at current pointFloor", () => {
    const configs = new Map([["goldstein-otp", cfg({ challenge: "goldstein-otp", pointMax: 25, pointFloor: 25 })]]);
    const r = computeUserScore({
      accomplishments: [], solves: [],
      events: [{ challenge: "goldstein-otp", bucket: "12345", scoredAt: "2026-08-05T19:00:00Z" }],
      configs,
    });
    expect(r.breakdown.flagPoints).toBe(25); // retuned from historical 100
  });

  it("over-globalMax ordinals value 0 but still light the ctf day", () => {
    const configs = new Map([["w", cfg({ challenge: "w", globalMax: 1 })]]);
    const r = computeUserScore({
      accomplishments: [], solves: [],
      events: [{ challenge: "w", bucket: "h1", ordinal: 2, scoredAt: "2026-08-05T19:00:00Z" }],
      configs,
    });
    expect(r.breakdown.flagPoints).toBe(0);
    expect(r.days.ctf).toBe(1);
  });

  it("latestActivityAt is the max accomplishment time", () => {
    const a = noon("2026-08-05"), b = noon("2026-08-07");
    const r = computeUserScore({
      accomplishments: [
        { source: "gpx", completedAt: a },
        { source: "checkin", completedAt: b },
      ],
      solves: [], events: [], configs: new Map(),
    });
    expect(r.latestActivityAt).toBe(b);
  });
});
