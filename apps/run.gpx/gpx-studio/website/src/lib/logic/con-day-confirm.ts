/**
 * Con-day confirmation logic — the "which day is this run for?" decision, made
 * from the file's OWN timestamp instead of from a chip the runner happened to
 * leave selected.
 *
 * Before this module, the QuickStart "Record Activity" upload path asked for a
 * day up front and then tagged whatever was pre-selected — which defaulted to
 * the latest selectable con-day. A runner uploading Thursday's GPX on Friday
 * silently got it tagged FRIDAY, even though the file said Thursday right there
 * in its first `<time>` element. Every other upload surface (bulk upload, the
 * Strava strip, the save-as dialog) already read the date; this one didn't.
 *
 * Everything here is PURE — no svelte, no DOM, no fetch. That is load-bearing:
 * the studio package has no test runner, so these functions are unit-tested from
 * the run.gpx webapp's vitest, which reaches across the package boundary
 * (`apps/run.gpx/webapp/src/lib/con-day-confirm.test.ts`). An import of
 * `svelte/store` here would fail to resolve there and take the suite down.
 */

/** Fixed offset for the con window — August 2026 is entirely PDT (UTC-7). */
export const CON_TZ_OFFSET_HOURS = -7;

/**
 * Convert an epoch-ms instant to its YYYY-MM-DD calendar date in the con's local
 * timezone. Shifting the instant by the fixed offset and reading UTC fields gives
 * the con-local date without pulling in Intl/timezone data.
 *
 * Kept in sync with `CON_TZ_OFFSET_HOURS` / `conLocalDate` in the webapp's
 * `con-days.ts`. `bulk-upload.ts` imports this one rather than keeping its own
 * copy — there were three identical implementations before.
 */
export function conLocalDate(epochMs: number): string {
    const shifted = new Date(epochMs + CON_TZ_OFFSET_HOURS * 3600_000);
    return shifted.toISOString().slice(0, 10);
}

/**
 * The shape this module needs from a `ConDayUsage` (served by
 * `GET /api/gpx/conday-usage`). Declared structurally rather than imported so
 * this file stays free of `$lib/cloud-sync`, which pulls in svelte stores.
 */
export interface ConDayLike {
    label: string;
    date: string;
    remaining: number;
    /** Server's answer to "is this day loggable now?" — a con day, not in the future. */
    selectable: boolean;
}

/**
 * What we concluded about an uploaded file's date, and therefore which screen the
 * runner sees before anything is committed.
 *
 * - `today`   — the file is from today's con day. The common case; one tap to log.
 * - `missed`  — the file is from an EARLIER con day. This is the "I missed a day"
 *               case, detected rather than asked about.
 * - `offcon`  — a real date, but outside Aug 5–10 (a July training run, a post-con
 *               run) or a con day in the FUTURE, which can't have happened yet.
 * - `unknown` — no parseable `<time>`; planner-drawn routes and some stripped
 *               watch exports have none.
 *
 * `offcon` and `unknown` both still offer the con-day chips (decision: never
 * block a runner from tagging), but with NOTHING pre-selected — a pre-selection
 * on a date we don't trust is how a one-tap mis-tag happens.
 */
export type ConDayConfirm =
    | { kind: 'today'; date: string; label: string }
    | { kind: 'missed'; date: string; label: string }
    | { kind: 'offcon'; date: string }
    | { kind: 'unknown' };

/**
 * Decide what to show for a guessed date. `guessedDate` is the con-local
 * YYYY-MM-DD read out of the file (`guessDateFromGpxText`) or the activity
 * (`startDateLocal`), or null when there was no timestamp to read.
 */
export function resolveConDayConfirm(
    guessedDate: string | null,
    days: readonly ConDayLike[],
    nowMs: number
): ConDayConfirm {
    if (!guessedDate) return { kind: 'unknown' };

    const day = days.find((d) => d.date === guessedDate);
    // Not one of the six con days at all.
    if (!day) return { kind: 'offcon', date: guessedDate };

    const today = conLocalDate(nowMs);
    if (guessedDate === today) return { kind: 'today', date: guessedDate, label: day.label };
    // A con day still ahead of us — the run hasn't happened, so don't call it a
    // missed day. Treated as untrusted, same as an off-window date.
    if (guessedDate > today) return { kind: 'offcon', date: guessedDate };
    return { kind: 'missed', date: guessedDate, label: day.label };
}

/**
 * The con-days a runner may pick from. `selectable` is the server's own
 * not-in-the-future answer, so this is simply "every day that has happened".
 *
 * Used by EVERY day picker now. The QuickStart hub already filtered this way but
 * the Strava strip and the save-as dialog offered all six, so the same runner
 * making the same decision saw different chips on different surfaces — and a
 * future day picked in the strip would have been rejected outright by
 * `POST /api/gpx/files`, which applies `isSelectableConDay`.
 */
export function pickableConDays<T extends ConDayLike>(days: readonly T[]): T[] {
    // Generic rather than `ConDayLike[]` so callers keep the full `ConDayUsage`
    // they passed in — narrowing to the structural minimum here would strip
    // fields the UI still needs (`count`, for the "N of 10 logged" line).
    return days.filter((d) => d.selectable);
}

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;

/**
 * "Aug 5" from "2026-08-05". Deliberately NOT `toLocaleDateString` — the chips
 * are compared against fixed strings in tests, and a locale-dependent formatter
 * makes that brittle for no user-visible gain inside a con-specific date window.
 */
export function shortConDate(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return date;
    const month = MONTHS[Number(m[2]) - 1];
    if (!month) return date;
    return `${month} ${Number(m[3])}`;
}

/**
 * Chip text: "Wed Aug 5". The hub previously rendered a bare `label.slice(0, 3)`
 * ("Wed") while the strip rendered the date too — on con day 1 the hub therefore
 * showed a single chip reading "Wed", which conveys nothing about which day is
 * selected or that other days exist.
 */
export function conDayChipLabel(day: ConDayLike): string {
    return `${day.label.slice(0, 3)} ${shortConDate(day.date)}`;
}

/** Full-sentence day name for the confirm screen: "Wednesday, Aug 5". */
export function longConDayLabel(day: ConDayLike): string {
    return `${day.label}, ${shortConDate(day.date)}`;
}

/** True when the day is at its per-con-day cap and can't take another run. */
export function isConDayFull(day: ConDayLike): boolean {
    return day.remaining <= 0;
}
