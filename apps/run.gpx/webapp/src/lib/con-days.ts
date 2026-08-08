/**
 * Con-day model (Phase 58).
 *
 * A "con-day" is one of the DEF CON 34 run days. Every logged run is tagged with
 * a `conDay` — the ISO calendar date (YYYY-MM-DD) of the day it was run — and
 * flags key off that tag. The value stored on `GpxFile.conDay` is always one of
 * the `CON_DAYS[].date` strings below.
 *
 * All helpers are pure and unit-testable. Dates are resolved in the con's local
 * timezone (America/Los_Angeles, PDT / UTC-7 for the whole August window) so that
 * a late-evening run doesn't roll into the next UTC day and mis-tag the con-day.
 */

/** Fixed offset for the con window (August 2026 is entirely PDT = UTC-7). */
export const CON_TZ_OFFSET_HOURS = -7;

export interface ConDay {
  /** Short stable key. */
  key: string;
  /** Human label for the picker. */
  label: string;
  /** Canonical stored value: ISO calendar date YYYY-MM-DD (con-local). */
  date: string;
}

/** DEF CON 34 run days — Wed Aug 5 through Mon Aug 10, 2026 (decided 2026-07-16). */
export const CON_DAYS: readonly ConDay[] = [
  { key: "wed", label: "Wednesday", date: "2026-08-05" },
  { key: "thu", label: "Thursday", date: "2026-08-06" },
  { key: "fri", label: "Friday", date: "2026-08-07" },
  { key: "sat", label: "Saturday", date: "2026-08-08" },
  { key: "sun", label: "Sunday", date: "2026-08-09" },
  { key: "mon", label: "Monday", date: "2026-08-10" },
] as const;

/** True if `date` (YYYY-MM-DD) is one of the con days. */
export function isConDay(date: string | null | undefined): boolean {
  return !!date && CON_DAYS.some((d) => d.date === date);
}

/** The con-day label for a stored date, or null if not a con day. */
export function conDayLabel(date: string | null | undefined): string | null {
  return CON_DAYS.find((d) => d.date === date)?.label ?? null;
}

/**
 * True if `s` is a syntactically valid ISO calendar date (YYYY-MM-DD) — a real
 * day (rejects e.g. 2026-02-31). Used ONLY for the admin any-date override, which
 * lets admins log/test a run for any day of the year, bypassing the con-day set
 * and the no-future gate. Non-admins are still held to isConDay + isSelectableConDay
 * on most paths — EXCEPT (decision 2026-07-21): the Strava strip's tap-to-import,
 * conDay file updates, and the save-as dialog, which deliberately accept ANY con
 * day (isConDay only, no future gate) so a runner can back-tag a run to an earlier
 * day of the con. The older upload/sync paths still apply isSelectableConDay.
 */
export function isValidDateString(s: string | null | undefined): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Round-trip guard: rejects impossible dates that Date.parse would roll over.
  return new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * Convert an epoch-ms instant to its YYYY-MM-DD calendar date in the con's local
 * timezone. Shifting the instant by the fixed offset and reading UTC fields gives
 * the con-local date without pulling in Intl/timezone data.
 */
export function conLocalDate(epochMs: number): string {
  const shifted = new Date(epochMs + CON_TZ_OFFSET_HOURS * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The con-day for "now" (epoch ms), or null if today isn't a con day. Used to
 * default the picker to today and to gate out future days server-side.
 */
export function todayConDay(nowMs: number): string | null {
  const today = conLocalDate(nowMs);
  return isConDay(today) ? today : null;
}

/**
 * Is `date` a con-day the runner may log against as of `nowMs`? A valid con-day
 * that is not in the future (con-local). Future days can't be logged — the run
 * hasn't happened yet.
 */
export function isSelectableConDay(
  date: string | null | undefined,
  nowMs: number
): boolean {
  if (!isConDay(date)) return false;
  return date! <= conLocalDate(nowMs); // ISO date strings sort lexicographically
}

/**
 * Best-guess con-day for an uploaded GPX: the con-local date of its first
 * `<time>` trackpoint, if that lands on a con day. Returns null when the GPX has
 * no timestamp or the run falls outside the con window (caller must then prompt
 * for a manual pick).
 */
export function guessConDayFromGpx(gpx: string): string | null {
  const m = gpx.match(/<time>\s*([^<\s]+)\s*<\/time>/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  if (Number.isNaN(t)) return null;
  const date = conLocalDate(t);
  return isConDay(date) ? date : null;
}

/**
 * Con days on which a SYNCED Strava activity is tagged automatically.
 *
 * NOW THE WHOLE CON WINDOW — identical to `CON_DAYS` (Kurt, 2026-08-08). It was
 * originally Aug 6–9 (Kurt, 2026-08-07), deliberately narrower, on the reasoning
 * that Aug 5 and Aug 10 could take a manual pick.
 *
 * WHY THAT CHANGED. Almost nobody makes the manual pick. By the morning of
 * Aug 8, twelve Wednesday activities across eleven runners — seven Runs, four
 * Walks, one HIIT — had synced, been stored, and were counting for NOTHING,
 * because `conDay` is the single gate on both real consumers:
 * `heatmap-build.ts:isSelected()` requires it, and a run only reaches the
 * leaderboard through the tagged path. Nothing told those runners; the runs
 * simply were not there. Monday Aug 10 was the identical hole with two days
 * left to fall into it.
 *
 * A DAY IN `CON_DAYS` BUT NOT HERE IS A TRAP, not a policy. It silently drops
 * real runs, and the only signal is an admin noticing a count that does not
 * add up. Cycling is still excluded (see `EXCLUDED_SPORTS`) — that filter is
 * about the ACTIVITY, which is a judgement the sweep can actually make, rather
 * than about the DAY, which it cannot.
 *
 * Kept as its own list rather than aliased to `CON_DAYS` so re-narrowing stays
 * a one-line edit — but the test below pins the two lists together, so dropping
 * a day from here now takes a deliberate test change.
 */
export const AUTO_CON_DAYS: readonly string[] = [
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
];

/**
 * Strava `sport_type` values never auto-tagged (Kurt, 2026-08-07: "if it's a
 * ride we will skip it"). The whole cycling family, since Strava splits it
 * across many values and excluding only "Ride" would let e-bikes and gravel
 * rides straight through.
 *
 * This is an AUTO-TAG rule only. A runner who deliberately picks a con-day for
 * a ride in the UI still gets it — the filter exists to stop the UNATTENDED
 * sweep making that call on their behalf, the same principle as `userInitiated`
 * on the treadmill flag.
 */
export const EXCLUDED_SPORTS: readonly string[] = [
  "ride",
  "mountainbikeride",
  "gravelride",
  "ebikeride",
  "emountainbikeride",
  "virtualride",
  "handcycle",
  "velomobile",
];

/**
 * The con-day for a synced Strava activity, or null to leave it untagged.
 *
 * Takes Strava's `start_date_local` — the athlete's WALL CLOCK start, which the
 * API sends with a misleading `Z` suffix (a 06:31 local run arrives as
 * "…T06:31:00Z" whatever timezone they were in). So the calendar date is the
 * literal first ten characters and NO offset may be applied: running this
 * through `conLocalDate` would shift a morning run back a day and a late-night
 * run is already correct without help. That is the opposite of
 * `guessConDayFromGpx`, which reads a genuine UTC instant and MUST shift.
 *
 * `sportType` is Strava's `sport_type`. Cycling is skipped; anything else —
 * including an unrecognised value — is tagged. That fail-OPEN default is
 * deliberate: a sport Strava adds tomorrow should not silently stop a real run
 * from counting, whereas the cost of tagging one unexpected activity is small.
 *
 * Returns null for anything unparseable rather than guessing — an untagged file
 * is merely inert, while a wrongly tagged one puts a run on the wrong day of
 * the heat map and awards a con-day the runner did not earn.
 *
 * THE single auto-tag decision, shared by the live sync and the backfill, so
 * the two can never disagree about the same row.
 */
export function autoConDayFromStrava(
  startDateLocal: string | null | undefined,
  sportType?: string | null
): string | null {
  if (!startDateLocal || !/^\d{4}-\d{2}-\d{2}T/.test(startDateLocal)) return null;
  if (sportType && EXCLUDED_SPORTS.includes(sportType.toLowerCase())) return null;
  const date = startDateLocal.slice(0, 10);
  return AUTO_CON_DAYS.includes(date) ? date : null;
}
