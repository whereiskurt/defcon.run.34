/**
 * Sponsor amount pure helpers.
 *
 * Extracted from `SponsorForm.tsx` in Plan 22-02-01 so BOTH the client
 * SponsorForm (browser render) and the server-rendered instruction
 * pages (`/sponsor/venmo`, `/sponsor/cashapp`) can share one source of
 * truth for the clamp + format contract. Importing a utility function
 * from a `"use client"` file into a server component works at runtime
 * but muddles the client/server boundary story — this dedicated lib
 * keeps the pure functions off the client-boundary map entirely.
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-02):
 * - Cents-first amounts. 100 cents = $1.
 * - Min $1, max $2000, $1 step. Matches the /api/checkout Zod bounds
 *   (100..200000) — any drift here surfaces as client-side clamped
 *   values that the API layer rejects with 400.
 * - clampAmountCents fail-safes NaN / Infinity to MIN (never $0).
 * - formatCentsUsd renders as $DD.CC (2 decimal places), always
 *   through the clamp so a runaway slider value never surfaces.
 */

export const AMOUNT_MIN_CENTS = 100; //   $1.00
export const AMOUNT_MAX_CENTS = 200_000; // $2000.00 (Kurt 2026-07-04: raised from $1000)
export const AMOUNT_STEP_CENTS = 100; //   $1.00 steps

/**
 * Clamp an amount (cents) into the design-contract range, snapping to
 * the step boundary. Pure, exported so vitest can pin the boundary
 * behavior without booting jsdom.
 *
 * - NaN / non-finite → AMOUNT_MIN_CENTS (fail-safe minimum, never $0).
 * - Values below MIN clamp to MIN.
 * - Values above MAX clamp to MAX.
 * - Fractional cents round DOWN to the nearest step (e.g. 4999 → 4900).
 *   This matches the Stripe Checkout expected shape (whole cents only).
 */
export function clampAmountCents(raw: number): number {
  if (!Number.isFinite(raw)) return AMOUNT_MIN_CENTS;
  const snapped = Math.floor(raw / AMOUNT_STEP_CENTS) * AMOUNT_STEP_CENTS;
  if (snapped < AMOUNT_MIN_CENTS) return AMOUNT_MIN_CENTS;
  if (snapped > AMOUNT_MAX_CENTS) return AMOUNT_MAX_CENTS;
  return snapped;
}

/**
 * Format cents to a display string like `$12.34`. Pure, exported so
 * tests can pin the format.
 */
export function formatCentsUsd(cents: number): string {
  const clamped = clampAmountCents(cents);
  const dollars = clamped / 100;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Parse an `amount_cents` query-string value (which may be a string,
 * array, or undefined per Next.js searchParams typing) into a clamped
 * integer. Used by the server-rendered `/sponsor/{venmo,cashapp}`
 * pages to sanitize the URL-provided amount before display.
 */
export function parseAmountCentsFromQuery(
  raw: string | string[] | undefined
): number {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string" || first.length === 0) {
    return AMOUNT_MIN_CENTS;
  }
  const parsed = Number.parseInt(first, 10);
  return clampAmountCents(parsed);
}
