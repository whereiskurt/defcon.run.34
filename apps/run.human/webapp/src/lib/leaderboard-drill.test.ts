import { describe, it, expect } from "vitest";
import { groupSocial, buildCtfLines, maskCtfLines, injectCheckinLocations, buildClusterLines, conDayCount, sectionTotal } from "./leaderboard-drill";

/**
 * Task 5 — pure lib for the leaderboard drill: social-scan day rollups +
 * named/masked CTF lines. See .superpowers/sdd/task-5-brief.md.
 */

describe("groupSocial", () => {
  it("groups social-scan rows by day (bucket.split('#')[0]), summing count/points, desc order, and lifts the jack-egg row", () => {
    const events = [
      { challenge: "social-scan", bucket: "2026-07-20#a-b", points: 2, scoredAt: "2026-07-20T10:00:00Z" },
      { challenge: "social-scan", bucket: "2026-07-20#a-c", points: 2, scoredAt: "2026-07-20T11:00:00Z" },
      { challenge: "social-scan", bucket: "2026-07-21#a-d", points: 2, scoredAt: "2026-07-21T09:00:00Z" },
      { challenge: "jack-egg", bucket: "once", points: 25, scoredAt: "2026-07-19T08:00:00Z" },
    ];

    const result = groupSocial(events);

    expect(result.days).toEqual([
      { day: "2026-07-21", count: 1, points: 2 },
      { day: "2026-07-20", count: 2, points: 4 },
    ]);
    expect(result.egg).toEqual({ points: 25, at: "2026-07-19T08:00:00Z" });
  });

  it("returns {days:[], egg:null} for no events", () => {
    expect(groupSocial([])).toEqual({ days: [], egg: null });
  });

  it("ignores non-social/jack-egg challenges", () => {
    const result = groupSocial([
      { challenge: "some-other-flag", bucket: "2026-07-20#x", points: 5, scoredAt: "2026-07-20T00:00:00Z" },
    ]);
    expect(result).toEqual({ days: [], egg: null });
  });
});

describe("buildCtfLines", () => {
  const names = new Map([["rainbow-bridge", "rainbow-bridge"]]);

  it("unions solves + events (excluding social-scan/jack-egg), names via the map, and sorts desc by at", () => {
    const solves = [
      { challenge: "rainbow-bridge", points: 10, channel: "qr" as const, solvedAt: "2026-07-20T10:00:00Z" },
    ];
    const events = [
      { challenge: "social-scan", points: 2, scoredAt: "2026-07-21T00:00:00Z" },
      { challenge: "jack-egg", points: 25, scoredAt: "2026-07-19T00:00:00Z" },
      { challenge: "chained-otp", points: 5, channel: "covert" as const, scoredAt: "2026-07-22T00:00:00Z" },
    ];

    const lines = buildCtfLines(solves, events, names);

    expect(lines).toEqual([
      { challenge: "chained-otp", name: "chained-otp", points: 5, channel: "covert", at: "2026-07-22T00:00:00Z" },
      { challenge: "rainbow-bridge", name: "rainbow-bridge", points: 10, channel: "qr", at: "2026-07-20T10:00:00Z" },
    ]);
  });

  it("falls back to the raw challenge slug when the name map has no entry", () => {
    const lines = buildCtfLines(
      [{ challenge: "deleted-flag", points: 1, solvedAt: "2026-07-20T00:00:00Z" }],
      [],
      new Map()
    );
    expect(lines[0].name).toBe("deleted-flag");
  });

  it("returns [] for no solves/events", () => {
    expect(buildCtfLines([], [], names)).toEqual([]);
  });
});

describe("maskCtfLines", () => {
  const covertLine = {
    challenge: "chained-otp",
    name: "Chained OTP",
    points: 5,
    channel: "covert" as const,
    at: "2026-07-22T00:00:00Z",
  };
  const qrLine = {
    challenge: "rainbow-bridge",
    name: "Rainbow Bridge",
    points: 10,
    channel: "qr" as const,
    at: "2026-07-20T00:00:00Z",
  };

  it("masks a covert line's name for a non-owner, non-admin viewer", () => {
    const masked = maskCtfLines([covertLine, qrLine], { isOwner: false, isAdmin: false });
    expect(masked[0].name).toBe("Covert flag");
    expect(masked[1].name).toBe("Rainbow Bridge");
  });

  it("does not mask for the owner", () => {
    const masked = maskCtfLines([covertLine], { isOwner: true, isAdmin: false });
    expect(masked[0].name).toBe("Chained OTP");
  });

  it("does not mask for an admin", () => {
    const masked = maskCtfLines([covertLine], { isOwner: false, isAdmin: true });
    expect(masked[0].name).toBe("Chained OTP");
  });

  it("never masks a qr line", () => {
    const masked = maskCtfLines([qrLine], { isOwner: false, isAdmin: false });
    expect(masked[0].name).toBe("Rainbow Bridge");
  });
});

describe("injectCheckinLocations", () => {
  const pubRow = { source: "checkin", metadata: { checkInId: "ci-1", points: 1 } };
  const checkins = [
    { checkInId: "ci-1", latitude: 36.135, longitude: -115.158, isPrivate: false },
    { checkInId: "ci-2", latitude: 36.1, longitude: -115.1, isPrivate: true },
  ];

  it("injects a single-point polyline for a public check-in", () => {
    const out = injectCheckinLocations([pubRow], checkins);
    expect(out[0].metadata?.polyline).toEqual([{ lat: 36.135, lng: -115.158 }]);
    // non-mutating
    expect(pubRow.metadata).not.toHaveProperty("polyline");
  });

  it("never injects for a private check-in", () => {
    const row = { source: "checkin", metadata: { checkInId: "ci-2", points: 1 } };
    expect(injectCheckinLocations([row], checkins)[0].metadata?.polyline).toBeUndefined();
  });

  it("leaves rows with a missing/unknown check-in or bad coords untouched", () => {
    const unknown = { source: "checkin", metadata: { checkInId: "nope", points: 1 } };
    const noId = { source: "checkin", metadata: { points: 1 } };
    const badCoords = injectCheckinLocations(
      [pubRow],
      [{ checkInId: "ci-1", latitude: Number.NaN, longitude: -115, isPrivate: false }]
    );
    expect(injectCheckinLocations([unknown], checkins)[0].metadata?.polyline).toBeUndefined();
    expect(injectCheckinLocations([noId], checkins)[0].metadata?.polyline).toBeUndefined();
    expect(badCoords[0].metadata?.polyline).toBeUndefined();
  });

  it("never touches non-checkin rows or rows that already carry a polyline", () => {
    const gpx = { source: "gpx", metadata: { gpxFileId: "f1", polyline: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] } };
    const preloaded = {
      source: "checkin",
      metadata: { checkInId: "ci-1", polyline: [{ lat: 9, lng: 9 }] },
    };
    const out = injectCheckinLocations([gpx, preloaded], checkins);
    expect(out[0]).toBe(gpx);
    expect(out[1].metadata?.polyline).toEqual([{ lat: 9, lng: 9 }]);
  });
});

describe("buildClusterLines", () => {
  const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);

  it("returns nothing for an empty ledger", () => {
    expect(buildClusterLines([], 3)).toEqual([]);
  });

  it("marks every award counted when under the cap", () => {
    const lines = buildClusterLines(
      [
        { startAt: at("2026-08-05", 14), size: 12, points: 50 },
        { startAt: at("2026-08-06", 14), size: 5, points: 25 },
      ],
      3,
    );
    expect(lines.every((l) => l.counted)).toBe(true);
  });

  it("drops the WORST award of a day when over the cap, not the latest", () => {
    const lines = buildClusterLines(
      [
        { startAt: at("2026-08-05", 13), size: 4, points: 25 },
        { startAt: at("2026-08-05", 16), size: 31, points: 200 },
        { startAt: at("2026-08-05", 19), size: 15, points: 100 },
        { startAt: at("2026-08-05", 22), size: 8, points: 50 },
      ],
      3,
    );
    const dropped = lines.filter((l) => !l.counted);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].points).toBe(25);
  });

  it("applies the cap per day independently", () => {
    const lines = buildClusterLines(
      [
        { startAt: at("2026-08-05", 13), size: 4, points: 25 },
        { startAt: at("2026-08-05", 16), size: 4, points: 25 },
        { startAt: at("2026-08-06", 13), size: 4, points: 25 },
        { startAt: at("2026-08-06", 16), size: 4, points: 25 },
      ],
      1,
    );
    expect(lines.filter((l) => l.counted)).toHaveLength(2);
  });

  it("sums counted points to the same total the engine computes", () => {
    const awards = [
      { startAt: at("2026-08-05", 13), size: 4, points: 25 },
      { startAt: at("2026-08-05", 16), size: 31, points: 200 },
      { startAt: at("2026-08-05", 19), size: 15, points: 100 },
      { startAt: at("2026-08-05", 22), size: 8, points: 50 },
    ];
    const lines = buildClusterLines(awards, 3);
    const total = lines.reduce((s, l) => s + (l.counted ? l.points : 0), 0);
    expect(total).toBe(350);
  });

  it("ignores awards outside the con days", () => {
    const lines = buildClusterLines(
      [{ startAt: Date.parse("2026-07-04T19:00:00Z"), size: 9, points: 50 }],
      3,
    );
    expect(lines).toEqual([]);
  });

  it("orders newest first", () => {
    const lines = buildClusterLines(
      [
        { startAt: at("2026-08-05", 13), size: 4, points: 25 },
        { startAt: at("2026-08-07", 13), size: 4, points: 25 },
      ],
      3,
    );
    expect(lines[0].day).toBe("2026-08-07");
  });
});

describe("conDayCount", () => {
  // CON_DAYS is 2026-08-05..10 (con-days.ts), PDT.
  it("counts distinct con days from epoch ms", () => {
    const noon = (d: string) => Date.parse(`${d}T19:00:00.000Z`); // 12:00 PDT
    expect(conDayCount([noon("2026-08-05"), noon("2026-08-06")])).toBe(2);
  });

  it("de-duplicates the same day", () => {
    const noon = Date.parse("2026-08-05T19:00:00.000Z");
    expect(conDayCount([noon, noon + 3_600_000, noon + 7_200_000])).toBe(1);
  });

  it("accepts an already-formatted YYYY-MM-DD (the social bucket shape)", () => {
    expect(conDayCount(["2026-08-05", "2026-08-06", "2026-08-05"])).toBe(2);
  });

  it("accepts ISO strings (the CTF solvedAt shape)", () => {
    expect(conDayCount(["2026-08-07T19:00:00.000Z"])).toBe(1);
  });

  it("ignores days outside the con", () => {
    expect(conDayCount(["2026-07-30", "2026-08-11", "2026-08-05"])).toBe(1);
  });

  it("SKIPS unparseable values rather than counting them", () => {
    // A NaN date must never inflate a streak.
    expect(conDayCount(["not-a-date", NaN, undefined, null, ""])).toBe(0);
  });
});

describe("sectionTotal", () => {
  // The streak table is [0, 25, 50, 100, 500], capped at 4+ days.
  it("adds the streak bonus to the section's own entry points", () => {
    expect(sectionTotal(4115, 4)).toBe(4615);
  });

  it("is the whole value for a zero-point track (runs, social)", () => {
    // Runs and scans are worth 0 each — the streak IS the contribution.
    // STREAK_POINTS is [0, 25, 50, 100, 500] INDEXED BY DAY COUNT — so a single
    // con day already pays 25, and only ZERO days pays nothing.
    expect(sectionTotal(0, 4)).toBe(500);
    expect(sectionTotal(0, 3)).toBe(100);
    expect(sectionTotal(0, 2)).toBe(50);
    expect(sectionTotal(0, 1)).toBe(25);
    expect(sectionTotal(0, 0)).toBe(0);
  });

  it("is just the entry points when no con day is covered", () => {
    expect(sectionTotal(250, 0)).toBe(250);
  });

  it("caps the streak at 4+ days", () => {
    expect(sectionTotal(0, 4)).toBe(sectionTotal(0, 6));
  });

  it("the three sections sum to the score minus cluster bonus", () => {
    // KPH's live showcase row: 11615 = runs + social + ctf + clusterBonus 6000.
    const runs = sectionTotal(0, 4);
    const social = sectionTotal(0, 4);
    const ctf = sectionTotal(4115, 4);
    expect(runs + social + ctf).toBe(11615 - 6000);
  });
});
