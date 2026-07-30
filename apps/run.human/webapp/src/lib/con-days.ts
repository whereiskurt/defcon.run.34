/**
 * Con-day model for scoring (mirrors apps/run.gpx/webapp/src/lib/con-days.ts —
 * kept as a local copy because run.human cannot import across apps; if the con
 * dates ever change, change BOTH files). August 2026 is entirely PDT (UTC-7),
 * so a fixed offset is exact — same convention as lib/social-day.ts.
 */
export const CON_TZ_OFFSET_HOURS = -7;

/** DEF CON 34 run days — Wed Aug 5 through Mon Aug 10, 2026. */
export const CON_DAYS: readonly string[] = [
  "2026-08-05", "2026-08-06", "2026-08-07",
  "2026-08-08", "2026-08-09", "2026-08-10",
];

/** Epoch-ms instant → YYYY-MM-DD in con-local (PDT) time. */
export function conLocalDate(epochMs: number): string {
  return new Date(epochMs + CON_TZ_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

export function isConDay(date: string): boolean {
  return CON_DAYS.includes(date);
}

/**
 * Total-by-streak table (spec §streak tracks): a track's TOTAL is this value
 * indexed by distinct active con days. Six con days exist but the table caps
 * at 4+ — running 4, 5, or 6 days all land on 500.
 */
export const STREAK_POINTS: readonly number[] = [0, 25, 50, 100, 500];

export function streakPoints(days: number): number {
  const d = Math.max(0, Math.min(days, STREAK_POINTS.length - 1));
  return STREAK_POINTS[d];
}
