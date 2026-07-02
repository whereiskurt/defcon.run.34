/**
 * Stripe Product IDs — created via API 2026-07-02 in Kurt's test-mode account.
 *
 * Referenced by `price_data.product` in Checkout Session create calls so the
 * Stripe dashboard groups per-session Prices under a single Product. Metadata
 * `donation_type` still discriminates in the webhook.
 *
 * Env override lets a different account (e.g. live-mode) supply its own IDs
 * without a code change.
 */
export const STRIPE_PRODUCT_BIB =
  process.env.STRIPE_PRODUCT_BIB ?? "prod_UoOw1e2QiETfr0";

export const STRIPE_PRODUCT_GENERAL =
  process.env.STRIPE_PRODUCT_GENERAL ?? "prod_UoOwrhvDGjgzol";
