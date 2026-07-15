/**
 * ctf-score-window — the pure, node-free, DST-correct scoring-window predicate and
 * its shared constants (Slice 2, CTFT-09/10/11).
 *
 * Structurally typed following `ctf-flag-types.ts` / `ctf-scoring.ts`: this module
 * does NOT import the `Ctf` entity or the ElectroDB client, because it is consumed
 * by BOTH sides of the trust boundary —
 *   - the SERVER judge (55-02) imports `isWithinScoreWindow` + the `ScoreWindow`
 *     type to gate a solve on the day/time window (judge step 3), and
 *   - the CLIENT form (55-03), via `ctf-form-model`, imports `DEFCON_RUN_HOURS`,
 *     `TZ_OPTIONS`, and the `ScoreWindow` type to drive the day/time/tz picker.
 *
 * It uses ONLY the built-in `Intl.DateTimeFormat` (zero new dependencies), so the
 * "6–8 AM PT" window is PDT in August and PST off-season automatically — the tz is
 * an IANA zone id, never a fixed offset.
 */

/**
 * An admin-authored scoring window.
 *
 * ⚠️ `from`/`to` here are WALL-CLOCK "HH:MM" strings (24h, zero-padded) evaluated
 * in `tz` — they are SEMANTICALLY DISTINCT from `Ctf.timeTiers`' `from`/`to`, which
 * are absolute UTC-ISO datetimes. The authoritative design spec's field table names
 * these `from`/`to` (`{ days:[0-6], from:"HH:MM", to:"HH:MM", tz:IANA }`); the
 * ROADMAP's CTFT-09 wording calls them `startTime`/`endTime` — resolved to
 * `from`/`to` per the authoritative spec.
 */
export interface ScoreWindow {
  /** JS `getDay` weekday indices: 0=Sun, 1=Mon, … 6=Sat. */
  days: number[];
  /** Inclusive lower bound, wall-clock "HH:MM" (24h) in `tz`. */
  from: string;
  /** Exclusive upper bound, wall-clock "HH:MM" (24h) in `tz`. */
  to: string;
  /** IANA zone id (e.g. "America/Los_Angeles"), evaluated via Intl (DST automatic). */
  tz: string;
}

/**
 * The single source of truth for the PT/ET/UTC ↔ IANA mapping. The picker renders
 * these three labels; both save (label→IANA) and rehydrate (IANA→label) resolve
 * through this exact ordered list. Order is display order.
 */
export const TZ_OPTIONS: ReadonlyArray<{ label: string; tz: string }> = [
  { label: "PT", tz: "America/Los_Angeles" },
  { label: "ET", tz: "America/New_York" },
  { label: "UTC", tz: "UTC" },
];

/**
 * The "DEF CON run hours" quick-set: Thu–Sun (weekday set {0,4,5,6}) from 06:00 to
 * 08:00 America/Los_Angeles. One chip in the picker fills the window with this.
 */
export const DEFCON_RUN_HOURS: ScoreWindow = {
  days: [0, 4, 5, 6],
  from: "06:00",
  to: "08:00",
  tz: "America/Los_Angeles",
};

/**
 * Map a JS `Intl` `weekday: "short"` value ("Sun".."Sat") to its `getDay` index.
 * Fixed by the "en-US" locale we format with, so it is deterministic.
 */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Is `nowMs` inside `window`?
 *
 * Evaluates the instant in `window.tz` with a SINGLE `Intl.DateTimeFormat` so the
 * UTC→local offset is DST-correct automatically (13:30 UTC is 06:30 PDT in summer
 * but 05:30 PST in winter). Derives the local weekday index and local "HH:MM", then
 * returns `days.includes(weekday) && from <= local < to`. The bound is HALF-OPEN
 * (`to` is exclusive), and "HH:MM" strings are compared lexicographically —
 * zero-padded 24h wall-clock sorts identically to minutes-since-midnight.
 *
 * FAIL-CLOSED: any error (an invalid/undecodable IANA tz makes `Intl` throw) is
 * caught and returns `false` — a bad window DENIES rather than leaks the reason.
 * The predicate sees ONLY the window and the clock; it never reads a guess/secret.
 */
/** Zero-padded 24h wall-clock "HH:MM", 00:00–23:59. */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate an admin-authored window at the WRITE boundary (WR-01). Returns a
 * human-readable error string for a DEGENERATE / never-scoring window, or `null`
 * when the window is well-formed.
 *
 * `isWithinScoreWindow` is half-open (`[from, to)`) and SAME-DAY — overnight
 * wrap-around is deliberately unsupported ("DEF CON run hours" are 6–8 AM). So any
 * window with no days, malformed times, or `to <= from` (including `from === to`
 * and empty times) can NEVER score at any instant. Rather than silently persist a
 * dead flag, callers reject the save and surface this message; the predicate stays
 * fail-closed as the runtime backstop.
 */
export function validateScoreWindow(window: ScoreWindow): string | null {
  if (!Array.isArray(window.days) || window.days.length === 0) {
    return "Pick at least one day for the scoring window.";
  }
  if (!HHMM_RE.test(window.from) || !HHMM_RE.test(window.to)) {
    return "Scoring window needs valid open and close times (HH:MM).";
  }
  if (window.to <= window.from) {
    return "Window close time must be after open time (overnight windows are not supported).";
  }
  return null;
}

export function isWithinScoreWindow(window: ScoreWindow, nowMs: number): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: window.tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(nowMs));

    let weekday = "";
    let hour = "";
    let minute = "";
    for (const p of parts) {
      if (p.type === "weekday") weekday = p.value;
      else if (p.type === "hour") hour = p.value;
      else if (p.type === "minute") minute = p.value;
    }

    const dayIndex = WEEKDAY_INDEX[weekday];
    if (dayIndex === undefined) return false;
    if (!window.days.includes(dayIndex)) return false;

    // Intl `hour12:false` can emit "24" at midnight in some engines; normalize to "00".
    const hh = hour === "24" ? "00" : hour;
    const local = `${hh}:${minute}`;

    return local >= window.from && local < window.to;
  } catch {
    // Fail-closed: undecodable tz (or any Intl error) denies.
    return false;
  }
}
