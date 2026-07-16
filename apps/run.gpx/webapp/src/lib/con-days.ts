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
