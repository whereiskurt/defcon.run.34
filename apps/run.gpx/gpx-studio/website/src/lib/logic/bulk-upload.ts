/**
 * Bulk-upload helpers (Phase 62) — client-side con-day guessing for the
 * "Upload many" flow (File ▸ Bulk).
 *
 * This mirrors the guess logic in the run.gpx webapp
 * (`apps/run.gpx/webapp/src/lib/con-days.ts` → `guessConDayFromGpx`). The studio
 * is a SEPARATE package and cannot import the webapp lib, so the tiny guess
 * routine is duplicated here. The AUTHORITATIVE con-day set (labels, caps,
 * selectability) still comes from `GET /api/gpx/conday-usage` (`ConDayUsage[]`);
 * this file only guesses a calendar date to pre-select in the picker, and the
 * server remains the source of truth for validity + quota.
 */

/**
 * Fixed offset for the con window — August 2026 is entirely PDT (UTC-7). Kept in
 * sync with `CON_TZ_OFFSET_HOURS` in the webapp `con-days.ts`.
 */
const CON_TZ_OFFSET_HOURS = -7;

/**
 * Convert an epoch-ms instant to its YYYY-MM-DD calendar date in the con's local
 * timezone. Shifting the instant by the fixed offset and reading UTC fields gives
 * the con-local date without pulling in Intl/timezone data.
 */
function conLocalDate(epochMs: number): string {
    const shifted = new Date(epochMs + CON_TZ_OFFSET_HOURS * 3600_000);
    return shifted.toISOString().slice(0, 10);
}

/**
 * Best-guess con-local calendar date (YYYY-MM-DD) from a GPX string's first
 * `<time>` trackpoint. Returns null when the GPX has no parseable timestamp — the
 * caller then flags the row and requires a manual day pick. The returned date is
 * NOT yet validated against the loggable con-day set; the caller cross-checks it
 * against `ConDayUsage` (so an off-con or future date still requires a pick).
 */
export function guessDateFromGpxText(text: string): string | null {
    const m = text.match(/<time>\s*([^<\s]+)\s*<\/time>/);
    if (!m) return null;
    const t = Date.parse(m[1]);
    if (Number.isNaN(t)) return null;
    return conLocalDate(t);
}

/** Read a picked File as UTF-8 text (thin wrapper for testability). */
export async function readGpxText(file: File): Promise<string> {
    return await file.text();
}
