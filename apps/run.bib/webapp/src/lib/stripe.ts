import Stripe from "stripe";
import { getSecureParam } from "./ssm";

/**
 * Stripe client — SSM-backed singleton.
 *
 * Design contract (v1.5 Phase 22 CONTEXT.md §"Locked design decisions"):
 * - Server-side ONLY. The raw `sk_test_*` / `sk_live_*` never enters the
 *   browser. Every call site (checkout create, webhook signature verify)
 *   goes through `getStripeClient()`.
 * - Test-vs-live is chosen by the `STRIPE_LIVE_MODE` env var (see
 *   `isLiveMode()`). Both credential pairs are injected into the task:
 *     test → `/dc34/secrets/use1/bib/stripe/{secret_key,webhook_signing_secret}`
 *            (env fallback `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SIGNING_SECRET`)
 *     live → the same paths suffixed `_live`
 *            (env fallback `STRIPE_SECRET_KEY_LIVE` /
 *            `STRIPE_WEBHOOK_SIGNING_SECRET_LIVE`)
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
 * Test-vs-live mode selector, driven by the `STRIPE_LIVE_MODE` env var
 * (injected as a plain container env in service.hcl). Only the exact string
 * `"true"` enables live mode — anything else (unset, "false", "1") stays on
 * the test-mode credentials, so a misconfig fails safe toward sandbox.
 *
 * Read at call time (not module load) so the running mode is always current
 * and tests can flip it. Both credential pairs are injected into the task;
 * this picks which env/SSM pair each helper reads.
 */
function isLiveMode(): boolean {
  return process.env.STRIPE_LIVE_MODE === "true";
}

interface StripeParamRef {
  envKey: string;
  ssmPath: string;
}

const SECRET_KEY_TEST: StripeParamRef = {
  envKey: "STRIPE_SECRET_KEY",
  ssmPath: "/dc34/secrets/use1/bib/stripe/secret_key",
};
const SECRET_KEY_LIVE: StripeParamRef = {
  envKey: "STRIPE_SECRET_KEY_LIVE",
  ssmPath: "/dc34/secrets/use1/bib/stripe/secret_key_live",
};
const WEBHOOK_SECRET_TEST: StripeParamRef = {
  envKey: "STRIPE_WEBHOOK_SIGNING_SECRET",
  ssmPath: "/dc34/secrets/use1/bib/stripe/webhook_signing_secret",
};
const WEBHOOK_SECRET_LIVE: StripeParamRef = {
  envKey: "STRIPE_WEBHOOK_SIGNING_SECRET_LIVE",
  ssmPath: "/dc34/secrets/use1/bib/stripe/webhook_signing_secret_live",
};

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
  const ref = isLiveMode() ? SECRET_KEY_LIVE : SECRET_KEY_TEST;
  const key = await getSecureParam(ref);

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
  return getSecureParam(isLiveMode() ? WEBHOOK_SECRET_LIVE : WEBHOOK_SECRET_TEST);
}

/**
 * Test-only: drop the memoized Stripe client so subsequent `getStripeClient()`
 * calls re-read the secret. Vitest teardown should call this + the SSM
 * cache reset so tests stay isolated.
 */
export function __resetStripeClientForTests(): void {
  cached = null;
}
