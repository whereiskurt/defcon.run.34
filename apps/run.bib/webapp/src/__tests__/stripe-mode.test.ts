import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * STRIPE_LIVE_MODE toggle unit tests.
 *
 * Verifies the test-vs-live selector in lib/stripe.ts and
 * config/stripe-products.ts:
 *   - unset / "false" / "1" → test-mode credentials + product IDs
 *   - exactly "true"        → live-mode credentials + product IDs
 *   - per-var env override still wins over both
 *
 * Uses the env-var fallback path in getSecureParam (no SSM/AWS needed):
 * the flag picks WHICH env var each helper reads, so a well-formed value
 * in that var proves the selection without a live Stripe account.
 */

// Capture the key passed to `new Stripe(key)` without a real client.
vi.mock("stripe", () => ({
  default: class {
    apiKey: string;
    constructor(key: string) {
      this.apiKey = key;
    }
  },
}));

import {
  getStripeClient,
  getStripeWebhookSecret,
  __resetStripeClientForTests,
} from "@/lib/stripe";
import { __resetSsmCacheForTests } from "@/lib/ssm";

const ENV_KEYS = [
  "STRIPE_LIVE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_SECRET_KEY_LIVE",
  "STRIPE_WEBHOOK_SIGNING_SECRET",
  "STRIPE_WEBHOOK_SIGNING_SECRET_LIVE",
  "STRIPE_PRODUCT_BIB",
  "STRIPE_PRODUCT_GENERAL",
  "STRIPE_PRODUCT_BIB_LIVE",
  "STRIPE_PRODUCT_GENERAL_LIVE",
];

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  clearEnv();
  __resetStripeClientForTests();
  __resetSsmCacheForTests();
});
afterEach(clearEnv);

async function clientKey(): Promise<string> {
  const client = (await getStripeClient()) as unknown as { apiKey: string };
  return client.apiKey;
}

describe("STRIPE_LIVE_MODE — secret key selection", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_AAA";
    process.env.STRIPE_SECRET_KEY_LIVE = "sk_live_BBB";
  });

  it("defaults to the test key when the flag is unset", async () => {
    expect(await clientKey()).toBe("sk_test_AAA");
  });

  it("uses the live key when the flag is exactly \"true\"", async () => {
    process.env.STRIPE_LIVE_MODE = "true";
    expect(await clientKey()).toBe("sk_live_BBB");
  });

  it("stays on the test key for any non-\"true\" value (fail-safe)", async () => {
    for (const v of ["false", "1", "TRUE", "yes", ""]) {
      process.env.STRIPE_LIVE_MODE = v;
      __resetStripeClientForTests();
      expect(await clientKey()).toBe("sk_test_AAA");
    }
  });
});

describe("STRIPE_LIVE_MODE — webhook secret selection", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SIGNING_SECRET = "whsec_test_AAA";
    process.env.STRIPE_WEBHOOK_SIGNING_SECRET_LIVE = "whsec_live_BBB";
  });

  it("defaults to the test webhook secret", async () => {
    expect(await getStripeWebhookSecret()).toBe("whsec_test_AAA");
  });

  it("uses the live webhook secret when the flag is \"true\"", async () => {
    process.env.STRIPE_LIVE_MODE = "true";
    expect(await getStripeWebhookSecret()).toBe("whsec_live_BBB");
  });
});

describe("product ID selection (mode-aware; live IDs from SSM env)", () => {
  async function loadProducts(env: Record<string, string> = {}) {
    vi.resetModules();
    clearEnv();
    Object.assign(process.env, env);
    return import("@/config/stripe-products");
  }

  it("uses the sandbox fallbacks in test mode", async () => {
    const p = await loadProducts();
    expect(p.STRIPE_PRODUCT_BIB).toBe("prod_UokaCinrlgtGNt");
    expect(p.STRIPE_PRODUCT_GENERAL).toBe("prod_Uol30buDvGTFiW");
  });

  it("uses the live fallbacks in live mode when no SSM env is set", async () => {
    const p = await loadProducts({ STRIPE_LIVE_MODE: "true" });
    expect(p.STRIPE_PRODUCT_BIB).toBe("prod_UrZhCH9JWyTTNt");
    expect(p.STRIPE_PRODUCT_GENERAL).toBe("prod_Uol30buDvGTFiW");
  });

  it("prefers the SSM-injected _LIVE env in live mode (swap without rebuild)", async () => {
    const p = await loadProducts({
      STRIPE_LIVE_MODE: "true",
      STRIPE_PRODUCT_BIB_LIVE: "prod_newlyswapped",
      STRIPE_PRODUCT_GENERAL_LIVE: "prod_genswapped",
    });
    expect(p.STRIPE_PRODUCT_BIB).toBe("prod_newlyswapped");
    expect(p.STRIPE_PRODUCT_GENERAL).toBe("prod_genswapped");
  });

  it("ignores the _LIVE env when in test mode", async () => {
    const p = await loadProducts({ STRIPE_PRODUCT_BIB_LIVE: "prod_shouldbeignored" });
    expect(p.STRIPE_PRODUCT_BIB).toBe("prod_UokaCinrlgtGNt");
  });

  it("lets the test-mode per-var env override win", async () => {
    const p = await loadProducts({ STRIPE_PRODUCT_BIB: "prod_override_XYZ" });
    expect(p.STRIPE_PRODUCT_BIB).toBe("prod_override_XYZ");
  });
});
