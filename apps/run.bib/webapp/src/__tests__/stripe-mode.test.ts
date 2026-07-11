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

describe("product IDs (mode-independent — copy-to-live preserved the IDs)", () => {
  async function loadProducts(mode?: string) {
    vi.resetModules();
    clearEnv();
    if (mode !== undefined) process.env.STRIPE_LIVE_MODE = mode;
    return import("@/config/stripe-products");
  }

  it("resolves the known IDs regardless of STRIPE_LIVE_MODE", async () => {
    for (const mode of [undefined, "true", "false"]) {
      const p = await loadProducts(mode);
      expect(p.STRIPE_PRODUCT_BIB).toBe("prod_UokaCinrlgtGNt");
      expect(p.STRIPE_PRODUCT_GENERAL).toBe("prod_Uol30buDvGTFiW");
    }
  });

  it("lets a per-var env override win", async () => {
    vi.resetModules();
    clearEnv();
    process.env.STRIPE_PRODUCT_BIB = "prod_override_XYZ";
    const p = await import("@/config/stripe-products");
    expect(p.STRIPE_PRODUCT_BIB).toBe("prod_override_XYZ");
  });
});
