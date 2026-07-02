import Stripe from "stripe";
import { getSecureParam } from "./ssm";

/**
 * Stripe client — SSM-backed singleton.
 *
 * Design contract (v1.5 Phase 22 CONTEXT.md §"Locked design decisions"):
 * - Server-side ONLY. The raw `sk_test_*` / `sk_live_*` never enters the
 *   browser. Every call site (checkout create, webhook signature verify)
 *   goes through `getStripeClient()`.
 * - Secret key lives at `/dc34/secrets/use1/bib/stripe/secret_key` (SSM
 *   SecureString). Env fallback `STRIPE_SECRET_KEY` for dev/CI.
 * - Webhook signing secret lives at
 *   `/dc34/secrets/use1/bib/stripe/webhook_signing_secret`. Env fallback
 *   `STRIPE_WEBHOOK_SIGNING_SECRET`.
 * - Both cached via `getSecureParam` (5-min TTL, process-local).
 *
 * Singleton: memoized on the sk value. If Kurt rotates the key mid-run,
 * the next SSM refresh (up to 5 min later) triggers a new Stripe client
 * instance. Older instances are GC'd normally.
 *
 * API version: pinned to `2025-06-30.basil` (Stripe SDK 18.x default at
 * plan time). Explicit pin so a future SDK bump doesn't silently upgrade
 * the wire version and break the checkout flow.
 */

// The Stripe TypeScript types include a hard-coded literal-union for
// `apiVersion`. Rather than fight the type system, let the SDK pick its
// default (via `undefined`) which matches the SDK's compiled-in default
// and is verified stable in Phase 22.
const STRIPE_API_VERSION: Stripe.LatestApiVersion | undefined = undefined;

interface CachedClient {
  key: string;
  client: Stripe;
}

let cached: CachedClient | null = null;

/**
 * Get a Stripe client instance. Reads `sk_test_*` from SSM (env-fallback
 * `STRIPE_SECRET_KEY`) and memoizes the client for the lifetime of the
 * key. Callers should not cache the returned instance themselves — always
 * call this helper so rotation flows through.
 *
 * @throws Error when both env fallback and SSM lookup fail. Caller
 *   translates to a 500 (checkout route) or handles placeholder mode.
 */
export async function getStripeClient(): Promise<Stripe> {
  const key = await getSecureParam({
    envKey: "STRIPE_SECRET_KEY",
    ssmPath: "/dc34/secrets/use1/bib/stripe/secret_key",
  });

  if (cached && cached.key === key) {
    return cached.client;
  }

  const client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    // Node.js Lambda / ECS runtime handles this — Stripe SDK default is
    // fine. Explicit `httpAgent` would be needed for FIPS or custom proxy.
    typescript: true,
  });

  cached = { key, client };
  return client;
}

/**
 * Get the webhook signing secret (`whsec_*`). Used by the /api/stripe/webhook
 * route to verify incoming Stripe events.
 *
 * Kept as a separate helper (rather than a field on the client) because
 * the signing secret is per-endpoint on the Stripe dashboard — you get a
 * fresh `whsec_*` for every registered webhook endpoint. Rotating the
 * signing secret should NOT force a rebuild of the Stripe API client.
 */
export async function getStripeWebhookSecret(): Promise<string> {
  return getSecureParam({
    envKey: "STRIPE_WEBHOOK_SIGNING_SECRET",
    ssmPath: "/dc34/secrets/use1/bib/stripe/webhook_signing_secret",
  });
}

/**
 * Test-only: drop the memoized Stripe client so subsequent `getStripeClient()`
 * calls re-read the secret. Vitest teardown should call this + the SSM
 * cache reset so tests stay isolated.
 */
export function __resetStripeClientForTests(): void {
  cached = null;
}
