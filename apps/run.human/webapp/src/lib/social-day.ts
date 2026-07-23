/**
 * Social-scan day bucket: calendar date at a FIXED -7h offset (Pacific
 * Daylight Time). DEF CON 34 (August 2026) is entirely inside PDT, so the
 * fixed offset is exact for the con and matches the run.gpx `con-days.ts`
 * convention — no Intl/IANA machinery for a hot-path key component.
 */

export const SOCIAL_TZ_OFFSET_HOURS = -7;

/** YYYY-MM-DD in social (PT) local time. Used as the pair/quota day key. */
export function socialDay(nowMs: number): string {
  return new Date(nowMs + SOCIAL_TZ_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
}
