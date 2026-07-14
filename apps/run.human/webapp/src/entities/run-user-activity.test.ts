import { describe, it, expect } from "vitest";
import { activityDelta } from "./run-user";

/**
 * Unit tests for the pure `activityDelta` helper behind the Phase 49 leaderboard
 * activity rollups (LDBR-02). This proves the sign + count-key invariants the
 * atomic mutator `updateRunUserActivityCounts` relies on WITHOUT touching
 * DynamoDB (the mutator itself is proven by the create/delete round-trip in
 * 49-03/49-04 and by tsc):
 *   - increment=true yields positive score/count deltas,
 *   - increment=false yields negative score/count deltas,
 *   - a non-1 points value flows straight through to scoreDelta,
 *   - countKey always equals the passed source (checkin↔checkin, gpx↔gpx).
 */

describe("activityDelta", () => {
  it("increments a check-in by +1", () => {
    expect(activityDelta("checkin", 1, true)).toEqual({
      scoreDelta: 1,
      countKey: "checkin",
      countDelta: 1,
    });
  });

  it("decrements a gpx by -1", () => {
    expect(activityDelta("gpx", 1, false)).toEqual({
      scoreDelta: -1,
      countKey: "gpx",
      countDelta: -1,
    });
  });

  it("passes a non-1 points value straight through to scoreDelta", () => {
    expect(activityDelta("checkin", 5, true).scoreDelta).toBe(5);
    expect(activityDelta("gpx", 3, false).scoreDelta).toBe(-3);
  });

  it("never crosses the countKey — it always equals the source", () => {
    expect(activityDelta("checkin", 1, true).countKey).toBe("checkin");
    expect(activityDelta("gpx", 1, true).countKey).toBe("gpx");
    // The count magnitude is 1 per accomplishment regardless of points value.
    expect(activityDelta("checkin", 5, true).countDelta).toBe(1);
    expect(activityDelta("gpx", 5, false).countDelta).toBe(-1);
  });
});
