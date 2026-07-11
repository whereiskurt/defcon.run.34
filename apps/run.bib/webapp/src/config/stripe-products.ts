/**
 * Stripe Product IDs.
 *   STRIPE_PRODUCT_GENERAL → "Global Participant" (general donation flow)
 *   STRIPE_PRODUCT_BIB     → "Bib Pickup (Custom)" (bib flow)
 *
 * Referenced by `price_data.product` in Checkout Session create calls so the
 * Stripe dashboard groups per-session Prices under a single Product. Metadata
 * `donation_type` still discriminates in the webhook.
 *
 * These IDs are valid in BOTH modes: the live account was seeded via Stripe's
 * "copy to live" which preserved the sandbox IDs, so the same strings resolve
 * to the (distinct) live objects when STRIPE_LIVE_MODE=true. No mode branch is
 * needed here — only the secret/webhook keys differ by mode (see lib/stripe.ts).
 *
 * Env override lets a different account supply its own IDs without a code
 * change (dev/CI or an emergency hot-patch).
 */
export const STRIPE_PRODUCT_BIB =
  process.env.STRIPE_PRODUCT_BIB ?? "prod_UokaCinrlgtGNt";

export const STRIPE_PRODUCT_GENERAL =
  process.env.STRIPE_PRODUCT_GENERAL ?? "prod_Uol30buDvGTFiW";
