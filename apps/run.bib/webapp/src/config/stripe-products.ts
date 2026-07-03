/**
 * Stripe Product IDs — Kurt's test-mode sandbox (rotated 2026-07-03).
 *   STRIPE_PRODUCT_GENERAL → "Global Participant" (general donation flow)
 *   STRIPE_PRODUCT_BIB     → "Bib Pickup (Custom)" (bib flow)
 *
 * Referenced by `price_data.product` in Checkout Session create calls so the
 * Stripe dashboard groups per-session Prices under a single Product. Metadata
 * `donation_type` still discriminates in the webhook.
 *
 * Env override lets a different account (e.g. live-mode) supply its own IDs
 * without a code change.
 */
export const STRIPE_PRODUCT_BIB =
  process.env.STRIPE_PRODUCT_BIB ?? "prod_UokaCinrlgtGNt";

export const STRIPE_PRODUCT_GENERAL =
  process.env.STRIPE_PRODUCT_GENERAL ?? "prod_Uol30buDvGTFiW";
