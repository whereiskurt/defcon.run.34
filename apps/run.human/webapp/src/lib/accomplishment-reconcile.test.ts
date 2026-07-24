import { describe, it, expect } from "vitest";
import {
  expectedAccomplishmentId,
  diffAccomplishments,
  type ReconcileRun,
} from "@/lib/accomplishment-reconcile";

/**
 * Reconcile diff lib (PURE) — Task 3, Step 1.
 *
 * `diffAccomplishments` compares the run.human Accomplishment rows a user
 * already has against the run set reported by the reconcile caller (run.gpx /
 * strava sync), producing:
 *   - orphanIds: gpx/strava rows that no longer correspond to any reported run
 *     (deleted on the source side) — checkin rows are NEVER orphaned, they are
 *     out of this reconcile's authority entirely.
 *   - missingFileIds: reported runs that have no existing accomplishment row
 *     yet (the gpxFileId of the run, not the minted accomplishmentId).
 */

describe("expectedAccomplishmentId", () => {
  it("mints strava#<id> when a strava run carries a stravaActivityId", () => {
    const run: ReconcileRun = {
      gpxFileId: "f",
      source: "strava",
      stravaActivityId: "9",
    };
    expect(expectedAccomplishmentId(run)).toBe("strava#9");
  });

  it("falls back to gpx#<gpxFileId> for a strava run with NO stravaActivityId", () => {
    const run: ReconcileRun = { gpxFileId: "f", source: "strava" };
    expect(expectedAccomplishmentId(run)).toBe("gpx#f");
  });

  it("mints gpx#<gpxFileId> for a gpx run", () => {
    const run: ReconcileRun = { gpxFileId: "f", source: "gpx" };
    expect(expectedAccomplishmentId(run)).toBe("gpx#f");
  });
});

describe("diffAccomplishments", () => {
  it("case 1: an orphan gpx row with no runs at all is reported as orphaned", () => {
    const existing = [{ accomplishmentId: "gpx#a", source: "gpx" }];
    const out = diffAccomplishments(existing, []);
    expect(out.orphanIds).toEqual(["gpx#a"]);
    expect(out.missingFileIds).toEqual([]);
  });

  it("case 2: checkin rows are NEVER orphaned, even with no matching runs", () => {
    const existing = [{ accomplishmentId: "checkin#c1", source: "checkin" }];
    const out = diffAccomplishments(existing, []);
    expect(out.orphanIds).toEqual([]);
  });

  it("case 3: a reported strava run with no existing row is missing (by gpxFileId)", () => {
    const runs: ReconcileRun[] = [
      { gpxFileId: "f", source: "strava", stravaActivityId: "9" },
    ];
    const out = diffAccomplishments([], runs);
    expect(out.missingFileIds).toEqual(["f"]);
    expect(out.orphanIds).toEqual([]);
  });

  it("case 4: a matched strava row produces an empty diff", () => {
    const existing = [{ accomplishmentId: "strava#9", source: "strava" }];
    const runs: ReconcileRun[] = [
      { gpxFileId: "f", source: "strava", stravaActivityId: "9" },
    ];
    const out = diffAccomplishments(existing, runs);
    expect(out.orphanIds).toEqual([]);
    expect(out.missingFileIds).toEqual([]);
  });

  it("case 5: a strava run with NO stravaActivityId matches the gpx#<id> row (fallback id)", () => {
    const existing = [{ accomplishmentId: "gpx#f", source: "gpx" }];
    const runs: ReconcileRun[] = [{ gpxFileId: "f", source: "strava" }];
    const out = diffAccomplishments(existing, runs);
    expect(out.orphanIds).toEqual([]);
    expect(out.missingFileIds).toEqual([]);
  });

  it("case 6: idempotent — diffing an already-matched set twice yields empty both times", () => {
    const existing = [
      { accomplishmentId: "gpx#f", source: "gpx" },
      { accomplishmentId: "strava#9", source: "strava" },
      { accomplishmentId: "checkin#c1", source: "checkin" },
    ];
    const runs: ReconcileRun[] = [
      { gpxFileId: "f", source: "gpx" },
      { gpxFileId: "g", source: "strava", stravaActivityId: "9" },
    ];
    const first = diffAccomplishments(existing, runs);
    const second = diffAccomplishments(existing, runs);
    expect(first).toEqual({ orphanIds: [], missingFileIds: [] });
    expect(second).toEqual({ orphanIds: [], missingFileIds: [] });
  });

  it("mixed: orphans a stale gpx row while reporting a genuinely missing run", () => {
    const existing = [
      { accomplishmentId: "gpx#dead", source: "gpx" },
      { accomplishmentId: "checkin#c1", source: "checkin" },
    ];
    const runs: ReconcileRun[] = [{ gpxFileId: "live", source: "gpx" }];
    const out = diffAccomplishments(existing, runs);
    expect(out.orphanIds).toEqual(["gpx#dead"]);
    expect(out.missingFileIds).toEqual(["live"]);
  });
});
