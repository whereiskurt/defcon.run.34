export type OrderStatus = "success" | "cancel" | "donated";

/**
 * Narrow the `?status=` querystring to a known order-status, else null.
 *
 * - `success`  → a completed BIB purchase (checkout/bib).
 * - `donated`  → a completed general DONATION (checkout/general) — gets its own
 *                thank-you + a one-shot cash rain (③ 2026-07-08).
 * - `cancel`   → checkout cancelled.
 */
export function parseStatus(
  raw: string | string[] | undefined
): OrderStatus | null {
  return raw === "success" || raw === "cancel" || raw === "donated"
    ? raw
    : null;
}
