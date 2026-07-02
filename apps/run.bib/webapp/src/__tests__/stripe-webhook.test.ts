import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/stripe/webhook signature-verify unit tests (Plan 22-01-4).
 *
 * We mock the Stripe SDK's `webhooks.constructEvent` + our SSM/entity
 * helpers so the route module can be exercised end-to-end without a
 * live Stripe endpoint or DynamoDB. What we pin here:
 *
 *   - missing Stripe-Signature header → 400
 *   - constructEvent throws → 400 (signature_invalid)
 *   - placeholder mode (no whsec) → 503
 *   - checkout.session.completed with metadata.owner_sub → applyPayment
 *     called with the right shape; 200
 *   - non-checkout.session.completed event types → 200 + not applied
 *   - bib-not-found → 200 (drop, no Stripe retry churn)
 *
 * We deliberately do NOT test signature verification with real HMAC
 * bytes — that's the Stripe SDK's job. Our contract is "if the SDK's
 * constructEvent throws, we return 400". A future E2E test with
 * `stripe listen` can exercise real signatures against a running dev
 * server.
 */

const mockConstructEvent = vi.fn();
const mockApplyPayment = vi.fn();
const mockGetWebhookSecret = vi.fn();
const mockGetStripeClient = vi.fn();

// --- Mocks (must be set up before the SUT import) --------------------

vi.mock("@/lib/stripe", () => ({
  getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
  getStripeWebhookSecret: (...args: unknown[]) =>
    mockGetWebhookSecret(...args),
}));

vi.mock("@/entities/bib", () => ({
  applyPayment: (...args: unknown[]) => mockApplyPayment(...args),
}));

// Import SUT after mocks.
import { POST } from "@/app/api/stripe/webhook/route";

function makeRequest({
  signature,
  body = "{}",
}: {
  signature?: string;
  body?: string;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function stripeStub() {
  return {
    webhooks: {
      constructEvent: (
        body: string,
        sig: string | string[] | Buffer,
        secret: string
      ) => mockConstructEvent(body, sig, secret),
    },
  } as unknown as { webhooks: { constructEvent: unknown } };
}

describe("/api/stripe/webhook POST", () => {
  beforeEach(() => {
    mockConstructEvent.mockReset();
    mockApplyPayment.mockReset();
    mockGetWebhookSecret.mockReset();
    mockGetStripeClient.mockReset();
    mockGetStripeClient.mockResolvedValue(stripeStub());
    mockGetWebhookSecret.mockResolvedValue("whsec_test_dummy");
  });

  it("returns 400 when Stripe-Signature header is missing", async () => {
    const req = makeRequest({ body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("missing_signature");
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it("returns 503 placeholder mode when webhook secret is not configured", async () => {
    mockGetWebhookSecret.mockRejectedValue(
      new Error(
        "SSM parameter /dc34/secrets/use1/bib/stripe/webhook_signing_secret returned no Value (env fallback STRIPE_WEBHOOK_SIGNING_SECRET also empty)"
      )
    );
    const req = makeRequest({ signature: "t=1,v1=abc", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("webhook signing secret not configured");
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const req = makeRequest({ signature: "t=1,v1=wrong", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("signature_invalid");
    expect(mockApplyPayment).not.toHaveBeenCalled();
  });

  it("returns 200 + skips applyPayment for unhandled event types", async () => {
    mockConstructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: { object: {} },
    });
    const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(mockApplyPayment).not.toHaveBeenCalled();
  });

  it("calls applyPayment with owner_sub + amount_total on checkout.session.completed (200)", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_ABC123",
          amount_total: 5000,
          metadata: {
            owner_sub: "user-alice",
            runner_code: "BIB-WXYZ",
            source: "bib",
          },
        },
      },
    });
    mockApplyPayment.mockResolvedValue({
      ownerSub: "user-alice",
      paidAmount: 5000,
    });

    const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    expect(mockApplyPayment).toHaveBeenCalledTimes(1);
    expect(mockApplyPayment).toHaveBeenCalledWith("user-alice", {
      provider: "stripe",
      amount_cents: 5000,
      reconciled_via: "stripe_webhook_cs_test_ABC123",
    });
  });

  it("returns 200 (drop) when session has no metadata.owner_sub", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_missing_meta",
          amount_total: 5000,
          metadata: {},
        },
      },
    });
    const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    expect(mockApplyPayment).not.toHaveBeenCalled();
  });

  it("returns 200 (drop) when bib does not exist for owner_sub", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_no_bib",
          amount_total: 5000,
          metadata: { owner_sub: "user-orphan" },
        },
      },
    });
    mockApplyPayment.mockRejectedValue(
      new Error("No bib found for ownerSub=user-orphan")
    );
    const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
  });

  it("returns 500 when applyPayment throws a non-not-found error (Stripe retries)", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_ddb_failure",
          amount_total: 5000,
          metadata: { owner_sub: "user-bob" },
        },
      },
    });
    mockApplyPayment.mockRejectedValue(new Error("DDB throttled"));
    const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("apply_failed");
  });

  it("returns 200 (drop) when amount_total is 0 (free / test session)", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_free",
          amount_total: 0,
          metadata: { owner_sub: "user-carol" },
        },
      },
    });
    const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    expect(mockApplyPayment).not.toHaveBeenCalled();
  });
});
