import { describe, it, expect } from "vitest";
import { dedupeActivities } from "./strava-sync";

/**
 * Unit coverage for the dedupe seam of the per-user Strava sync (Phase 61).
 *
 * dedupeActivities is the correctness guard shared by both doors: a re-sync must
 * never re-import an activity already in the folder (keyed by stravaActivityId),
 * and it must preserve Strava's most-recent-first order for the ones it keeps.
 */
describe("dedupeActivities", () => {
  it("keeps only activities not already imported, preserving order", () => {
    const activities = [{ id: 3 }, { id: 2 }, { id: 1 }];
    const seen = new Set(["2"]); // id 2 already imported

    const { fresh, skipped } = dedupeActivities(activities, seen);

    expect(fresh.map((a) => a.id)).toEqual([3, 1]);
    expect(skipped).toBe(1);
  });

  it("skips everything when all are already imported", () => {
    const activities = [{ id: 10 }, { id: 11 }];
    const seen = new Set(["10", "11"]);

    const { fresh, skipped } = dedupeActivities(activities, seen);

    expect(fresh).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("keeps everything when nothing has been imported", () => {
    const activities = [{ id: 1 }, { id: 2 }];

    const { fresh, skipped } = dedupeActivities(activities, new Set());

    expect(fresh).toEqual([{ id: 1 }, { id: 2 }]);
    expect(skipped).toBe(0);
  });

  it("matches numeric ids against string-keyed seen set (dedupe key type guard)", () => {
    // stravaActivityId is stored as a string on GpxFile; the activity id is a
    // number. The seen set is string-keyed, so the comparison must stringify.
    const { fresh, skipped } = dedupeActivities([{ id: 42 }], new Set(["42"]));

    expect(fresh).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("is empty-safe", () => {
    const { fresh, skipped } = dedupeActivities([], new Set(["1"]));
    expect(fresh).toEqual([]);
    expect(skipped).toBe(0);
  });
});
