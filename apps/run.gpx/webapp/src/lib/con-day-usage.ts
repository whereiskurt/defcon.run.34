/**
 * Per-con-day usage counts (Phase 59).
 *
 * Reads the runner's own files and counts how many are tagged to each con-day.
 * The cap is a count (not a countdown), keyed on `conDay`, so it is catch-up
 * safe. Lifetime abuse is separately bounded by the `gpx_upload` quota (100),
 * so this filtered query over a runner's own partition (≤100 items) needs no
 * GSI. `failed` uploads don't count.
 */

import { GpxFile } from "@/entities/gpx-file";
import { CON_DAYS, isSelectableConDay } from "./con-days";
import { conDayRemaining } from "./con-day-quota";
import type { QuotaTier } from "./quota-client";

/** Count of the runner's non-failed files tagged to a single con-day. */
export async function countConDayRuns(
  userId: string,
  conDay: string
): Promise<number> {
  const res = await GpxFile.query.primary({ userId }).go({ pages: "all" });
  return res.data.filter(
    (f) => f.conDay === conDay && f.status !== "failed"
  ).length;
}

export interface ConDayUsage {
  key: string;
  label: string;
  date: string;
  count: number;
  remaining: number;
  /** False for future con-days (can't log a run that hasn't happened). */
  selectable: boolean;
}

/**
 * Usage across every con-day for the runner — count, remaining, and whether the
 * day is loggable as of `nowMs`. One partition read, grouped in memory. The card
 * uses this to render "N of 10 · Sat" and to grey out future days.
 */
export async function getConDayUsage(
  userId: string,
  tier: QuotaTier,
  nowMs: number
): Promise<ConDayUsage[]> {
  const res = await GpxFile.query.primary({ userId }).go({ pages: "all" });
  const counts = new Map<string, number>();
  for (const f of res.data) {
    if (f.conDay && f.status !== "failed") {
      counts.set(f.conDay, (counts.get(f.conDay) ?? 0) + 1);
    }
  }
  return CON_DAYS.map((d) => {
    const count = counts.get(d.date) ?? 0;
    return {
      key: d.key,
      label: d.label,
      date: d.date,
      count,
      remaining: conDayRemaining(count, tier),
      selectable: isSelectableConDay(d.date, nowMs),
    };
  });
}
