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

import { conLocalDate } from './con-day-confirm';

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
