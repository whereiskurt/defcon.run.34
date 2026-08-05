/**
 * "ELKENTARO 2000" treadmill flag (2026-08-05, Kurt).
 *
 * A 250-point CTF flag for logging an INDOOR run recorded between Aug 3 and
 * Aug 10 2026 inclusive. The window is deliberately wider than the con days
 * (Aug 5–10) at Kurt's request, so a treadmill run from the two days before the
 * con opens still counts.
 *
 * The gate is the run's OWN recorded date, not when it was uploaded — someone
 * who ran indoors on Aug 4 and imports it on Aug 9 qualifies, and someone who
 * imports a January treadmill run during the con does not. That is why this
 * cannot use the `Ctf.scoreWindow` gate, which evaluates the SOLVE time.
 *
 * Pure and dependency-free so the rules are unit-tested rather than trusted.
 * The award itself is granted server-side by run.human (judgeSolve `grant`),
 * never derived from anything a client sends.
 */

/** Inclusive ISO date bounds for a qualifying run. */
export const TREADMILL_WINDOW_START = "2026-08-03";
export const TREADMILL_WINDOW_END = "2026-08-10";

/** The Ctf challenge name this flag scores against. */
export const TREADMILL_CHALLENGE = "treadmill";

/**
 * Is this activity an indoor/treadmill run?
 *
 * Two independent signals, either sufficient:
 *  - `trainer: true` — Strava's own explicit indoor marker, authoritative.
 *  - no GPS track — a treadmill produces no `summary_polyline` and no `latlng`
 *    stream. This also catches indoor activities Strava failed to flag, and
 *    trackless GPX uploads.
 */
export function isTreadmillActivity(activity: {
  trainer?: boolean | null;
  map?: { summary_polyline?: string | null } | null;
}): boolean {
  if (activity.trainer === true) return true;
  return !activity.map?.summary_polyline;
}

/**
 * Does an ISO calendar date (YYYY-MM-DD) fall inside the flag window?
 * ISO date strings compare lexicographically, so plain string compare is exact
 * and timezone-free — the caller is responsible for having already resolved the
 * date in the con's local zone.
 */
export function isInTreadmillWindow(date: string | null | undefined): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date >= TREADMILL_WINDOW_START && date <= TREADMILL_WINDOW_END;
}

/**
 * The full predicate for a Strava import: an indoor activity whose own recorded
 * date lands in the window.
 *
 * `start_date_local` is Strava's Z-suffixed LOCAL wall-clock time, so the date
 * part is already the athlete's local day — slice it, never timezone-shift it.
 */
export function qualifiesForTreadmillFlag(activity: {
  trainer?: boolean | null;
  map?: { summary_polyline?: string | null } | null;
  start_date_local?: string | null;
}): boolean {
  if (!isTreadmillActivity(activity)) return false;
  return isInTreadmillWindow((activity.start_date_local ?? "").slice(0, 10));
}
