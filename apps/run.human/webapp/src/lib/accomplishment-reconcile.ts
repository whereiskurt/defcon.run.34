/**
 * Reconcile diff lib (PURE) — Task 3.
 *
 * The internal reconcile endpoint (`api/internal/accomplishment/reconcile`)
 * calls into this module to diff a user's Accomplishment rows against the run
 * set reported by the source of truth (run.gpx files / strava sync). Kept
 * pure and entity-free so it is trivially unit testable.
 */

/** A run reported by the caller (run.gpx / strava sync) as still existing. */
export type ReconcileRun = {
  gpxFileId: string;
  source: "gpx" | "strava";
  stravaActivityId?: string;
};

/**
 * The accomplishmentId a run WOULD have if it were scored — mirrors
 * `accomplishmentIdFor` in `@/entities/accomplishment` (kept independent here
 * so this lib stays entity-free/pure): `strava#<stravaActivityId>` when a
 * strava run carries an activity id, otherwise `gpx#<gpxFileId>` (covers both
 * plain gpx runs and a strava run that hasn't recorded an activity id yet).
 */
export function expectedAccomplishmentId(run: ReconcileRun): string {
  if (run.source === "strava" && run.stravaActivityId) {
    return `strava#${run.stravaActivityId}`;
  }
  return `gpx#${run.gpxFileId}`;
}

/**
 * Diff a user's existing Accomplishment rows against the reported run set.
 *
 * - `orphanIds`: existing gpx/strava rows whose id no longer matches any
 *   reported run — these are stale (the source-side file/activity was
 *   deleted) and should be removed. `checkin` rows are out of this
 *   reconcile's authority and are NEVER included, matched or not.
 * - `missingFileIds`: reported runs with no existing row yet, identified by
 *   `gpxFileId` (not the minted accomplishmentId) since that's what the
 *   caller/creator route keys on.
 */
export function diffAccomplishments(
  existing: { accomplishmentId: string; source: string }[],
  runs: ReconcileRun[]
): { orphanIds: string[]; missingFileIds: string[] } {
  const expectedIds = new Set(runs.map(expectedAccomplishmentId));
  const existingIds = new Set(existing.map((row) => row.accomplishmentId));

  const orphanIds = existing
    .filter((row) => row.source === "gpx" || row.source === "strava")
    .filter((row) => !expectedIds.has(row.accomplishmentId))
    .map((row) => row.accomplishmentId);

  const missingFileIds = runs
    .filter((run) => !existingIds.has(expectedAccomplishmentId(run)))
    .map((run) => run.gpxFileId);

  return { orphanIds, missingFileIds };
}
