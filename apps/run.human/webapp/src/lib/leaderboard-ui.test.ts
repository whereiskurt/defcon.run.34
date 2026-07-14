import { describe, it, expect } from "vitest";
import { runnerClassEmoji, deriveCountChips } from "./leaderboard-ui";

/**
 * Pure-core unit tests for the two Phase-52 leaderboard UI seams (LDBR-10):
 *   - runnerClassEmoji: mqttUsertype → emoji (DC33 parity for wildhare/og),
 *   - deriveCountChips: activityCounts + ctfSolves → chip {key,count,color},
 *     rendering 0 gracefully when the source fields are missing (SC #4).
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

describe("deriveCountChips — activity + ctf derivation (SC #4)", () => {
  it("sums checkin+gpx into the green activity chip and surfaces ctfSolves in the orange ctf chip", () => {
    const chips = deriveCountChips({
      activityCounts: { checkin: 3, gpx: 2 },
      ctfSolves: 4,
    });
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c]));
    expect(byKey.activity).toEqual({ key: "activity", count: 5, color: "success" });
    expect(byKey.ctf).toEqual({ key: "ctf", count: 4, color: "warning" });
  });

  it("renders 0 gracefully when activityCounts and ctfSolves are absent", () => {
    const chips = deriveCountChips({});
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c]));
    expect(byKey.activity.count).toBe(0);
    expect(byKey.ctf.count).toBe(0);
    expect(Number.isNaN(byKey.activity.count)).toBe(false);
    expect(Number.isNaN(byKey.ctf.count)).toBe(false);
  });

  it("treats a partially-present activityCounts (only checkin) as gpx 0", () => {
    const chips = deriveCountChips({ activityCounts: { checkin: 7 } });
    const activity = chips.find((c) => c.key === "activity");
    expect(activity?.count).toBe(7);
  });

  it("always returns exactly the activity then ctf chips, in that order", () => {
    const chips = deriveCountChips({ activityCounts: { checkin: 1, gpx: 1 }, ctfSolves: 9 });
    expect(chips.map((c) => c.key)).toEqual(["activity", "ctf"]);
    expect(chips.map((c) => c.color)).toEqual(["success", "warning"]);
  });
});
