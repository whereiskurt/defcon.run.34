/**
 * Per-day cap for the untagged "Sync now" button (Task 2, scheduled-Strava-sync
 * milestone). Unlike the tagged "Sync my Strava" button (con-day budget +
 * lifetime gpx_upload quota, see con-day-quota.ts), sync-now has no con-day tag
 * and no quota — just a flat 2/day counter per user, keyed on the con-local
 * calendar date (see conLocalDate in @/lib/con-days). Pure so the cap decision
 * is unit-testable without DynamoDB; the counter row itself lives in
 * @/entities/gpx-sync-now.
 */

/** Untagged syncs a runner may trigger per con-local day. */
export const SYNC_NOW_PER_DAY = 2;

/** Syncs still available today given how many are already used. */
export function syncNowRemaining(count: number): number {
  return Math.max(0, SYNC_NOW_PER_DAY - Math.max(0, count));
}

/** True when the runner has used up today's syncs. */
export function isSyncNowCapped(count: number): boolean {
  return syncNowRemaining(count) <= 0;
}
