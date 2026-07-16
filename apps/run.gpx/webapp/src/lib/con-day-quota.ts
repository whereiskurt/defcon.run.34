/**
 * Per-con-day run quota (Phase 59).
 *
 * A runner may log at most N runs tagged to any single con-day. Unlike the
 * lifetime `gpx_upload` quota (a countdown in run.auth), this cap is a COUNT of
 * the runner's own files carrying a given `conDay` — so it is keyed on the con
 * day itself, not the calendar day the upload happens. That makes day-4 "catch
 * up" work: each con-day carries its own budget of N.
 *
 * The count query lives in con-day-usage.ts; the decisions here are pure so the
 * cap logic is unit-testable without DynamoDB. Both the manual upload path and
 * the Strava sync path (Phase 61) consume against the SAME count, so switching
 * doors can't bypass the cap.
 *
 * Tiers mirror the run.gpx quota tiers (zero | upload | admin). Admins are
 * effectively uncapped.
 */

import type { QuotaTier } from "./quota-client";

/** Runs a normal runner may tag to a single con-day. */
export const PER_CON_DAY_LIMIT = 10;

/** Per-con-day run limit for a quota tier. */
export function conDayLimit(tier: QuotaTier): number {
  if (tier === "admin") return Number.MAX_SAFE_INTEGER;
  if (tier === "zero") return 0;
  return PER_CON_DAY_LIMIT; // "upload"
}

/** Runs still loggable for a con-day given how many are already tagged to it. */
export function conDayRemaining(count: number, tier: QuotaTier): number {
  return Math.max(0, conDayLimit(tier) - Math.max(0, count));
}

/** True when the runner has hit the cap for this con-day. */
export function isConDayCapped(count: number, tier: QuotaTier): boolean {
  return conDayRemaining(count, tier) <= 0;
}
