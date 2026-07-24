import { describe, it, expect } from "vitest";
import { groupSocial, buildCtfLines, maskCtfLines } from "./leaderboard-drill";

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
