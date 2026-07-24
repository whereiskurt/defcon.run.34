import { describe, it, expect } from "vitest";
import { runnerClassEmoji, deriveCountChips } from "./leaderboard-ui";

/**
 * Pure-core unit tests for the two Phase-52 leaderboard UI seams (LDBR-10):
 *   - runnerClassEmoji: mqttUsertype → emoji (DC33 parity for wildhare/og),
 *   - deriveCountChips: activityCounts (checkin+gpx+strava) + ctfSolves +
 *     socialScore → chip {key,count,color}, rendering 0 gracefully when the
 *     source fields are missing (SC #4). Returns exactly
 *     [activity, social, ctf] — strava joined the activity rollup and a new
 *     social chip surfaces the runner-social-QR score (leaderboard runs-sync
 *     Task 1).
 *
 * No React, no DOM — plain fixtures, mirroring leaderboard-data.test.ts.
 */

describe("runnerClassEmoji — DC33 parity + DC34 extension", () => {
  it("maps wildhare to ⭐️ and og to 🤠 (DC33 parity)", () => {
    expect(runnerClassEmoji("wildhare")).toBe("⭐️");
    expect(runnerClassEmoji("og")).toBe("🤠");
  });

  it("returns a sensible non-empty emoji for rabbit and admin", () => {
    expect(runnerClassEmoji("rabbit")).not.toBe("");
    expect(runnerClassEmoji("admin")).not.toBe("");
    // documented DC34 choices
    expect(runnerClassEmoji("rabbit")).toBe("🐇");
    expect(runnerClassEmoji("admin")).toBe("🛡️");
  });

  it("returns '' for undefined and unknown class (no trailing emoji)", () => {
    expect(runnerClassEmoji(undefined)).toBe("");
    // an unrecognized value degrades to no emoji, never throws
    expect(runnerClassEmoji("nope" as never)).toBe("");
  });
});

describe("deriveCountChips — activity + social + ctf derivation (SC #4)", () => {
  it("sums checkin+gpx+strava into the green activity chip, socialScore into the secondary social chip, and ctfSolves into the orange ctf chip", () => {
    const chips = deriveCountChips({
      activityCounts: { checkin: 1, gpx: 1, strava: 2 },
      ctfSolves: 1,
      socialScore: 4,
    });
    expect(chips).toEqual([
      { key: "activity", count: 4, color: "success" },
      { key: "social", count: 4, color: "secondary" },
      { key: "ctf", count: 1, color: "warning" },
    ]);
  });

  it("renders 0 gracefully when activityCounts, ctfSolves, and socialScore are all absent", () => {
    const chips = deriveCountChips({});
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c]));
    expect(byKey.activity.count).toBe(0);
    expect(byKey.social.count).toBe(0);
    expect(byKey.ctf.count).toBe(0);
    expect(Number.isNaN(byKey.activity.count)).toBe(false);
    expect(Number.isNaN(byKey.social.count)).toBe(false);
    expect(Number.isNaN(byKey.ctf.count)).toBe(false);
  });

  it("treats a partially-present activityCounts (only checkin) as gpx/strava 0", () => {
    const chips = deriveCountChips({ activityCounts: { checkin: 7 } });
    const activity = chips.find((c) => c.key === "activity");
    expect(activity?.count).toBe(7);
  });

  it("always returns exactly the activity, social, then ctf chips, in that order", () => {
    const chips = deriveCountChips({
      activityCounts: { checkin: 1, gpx: 1, strava: 1 },
      ctfSolves: 9,
      socialScore: 2,
    });
    expect(chips.map((c) => c.key)).toEqual(["activity", "social", "ctf"]);
    expect(chips.map((c) => c.color)).toEqual(["success", "secondary", "warning"]);
  });
});
