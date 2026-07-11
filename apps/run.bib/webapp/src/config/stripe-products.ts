/**
 * Stripe Product IDs.
 *   STRIPE_PRODUCT_GENERAL → "Global Participant" (general donation flow)
 *   STRIPE_PRODUCT_BIB     → "Bib Pickup (Custom)" (bib flow)
 *
 * Referenced by `price_data.product` in Checkout Session create calls so the
 * Stripe dashboard groups per-session Prices under a single Product. Metadata
 * `donation_type` still discriminates in the webhook.
 *
 * Mode-aware (mirrors the key toggle in lib/stripe.ts): live-mode product IDs
 * differ from the sandbox ones and are supplied via SSM so a dashboard product
 * swap is a `put-parameter` + task refresh — no image rebuild. Resolution order
 * per mode:
 *   live  → env STRIPE_PRODUCT_*_LIVE (from SSM `.../stripe/product_*_live`),
 *           else the baked live fallback.
 *   test  → env STRIPE_PRODUCT_* (dev/CI), else the baked sandbox fallback.
 *
 * The baked fallbacks are last-resort only; SSM is the source of truth in prod.
 */

// Baked fallbacks (last resort if the SSM-injected env is missing).
const TEST_PRODUCT_BIB = "prod_UokaCinrlgtGNt";
const TEST_PRODUCT_GENERAL = "prod_Uol30buDvGTFiW";
const LIVE_PRODUCT_BIB = "prod_UrZhCH9JWyTTNt";
const LIVE_PRODUCT_GENERAL = "prod_Uol30buDvGTFiW";

const live = process.env.STRIPE_LIVE_MODE === "true";

export const STRIPE_PRODUCT_BIB =
  (live ? process.env.STRIPE_PRODUCT_BIB_LIVE : process.env.STRIPE_PRODUCT_BIB) ??
  (live ? LIVE_PRODUCT_BIB : TEST_PRODUCT_BIB);

export const STRIPE_PRODUCT_GENERAL =
  (live
    ? process.env.STRIPE_PRODUCT_GENERAL_LIVE
    : process.env.STRIPE_PRODUCT_GENERAL) ??
  (live ? LIVE_PRODUCT_GENERAL : TEST_PRODUCT_GENERAL);
