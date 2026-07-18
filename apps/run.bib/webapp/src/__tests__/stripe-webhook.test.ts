import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/stripe/webhook signature-verify unit tests (Plan 22-01-4 +
 * Phase 22-05 §22-05-03 donation_type branch).
 *
 * We mock the Stripe SDK's `webhooks.constructEvent` + our SSM/entity
 * helpers so the route module can be exercised end-to-end without a
 * live Stripe endpoint or DynamoDB. What we pin here:
 *
 *   - missing Stripe-Signature header → 400
 *   - constructEvent throws → 400 (signature_invalid)
 *   - placeholder mode (no whsec) → 503
 *   - checkout.session.completed with donation_type=bib →
 *     applyPayment called with the right shape; 200
 *   - checkout.session.completed with donation_type=general →
 *     recordDonation called with the right shape; 200
 *   - checkout.session.completed with unknown / missing donation_type →
 *     200, no entity mutation
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
const mockRecordDonation = vi.fn();
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

vi.mock("@/entities/general-donation", () => ({
  recordDonation: (...args: unknown[]) => mockRecordDonation(...args),
  stripeSessionDonationId: (sessionId: string) => `stripe:${sessionId}`,
}));

// Cache invalidation is an orthogonal side effect that needs Next's request
// store (absent when the handler is invoked directly here). No-op it.
vi.mock("@/lib/report-cache", () => ({
  invalidateBib: vi.fn(),
  invalidateReports: vi.fn(),
  invalidateOwner: vi.fn(),
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
    mockRecordDonation.mockReset();
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
    expect(mockRecordDonation).not.toHaveBeenCalled();
  });

  it("returns 200 + skips both entity paths for unhandled event types", async () => {
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
    expect(mockRecordDonation).not.toHaveBeenCalled();
  });

  describe("donation_type=bib branch", () => {
    it("calls applyPayment with owner_sub + amount_total on checkout.session.completed (200)", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_ABC123",
            amount_total: 5000,
            metadata: {
              donation_type: "bib",
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
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      expect(mockApplyPayment).toHaveBeenCalledTimes(1);
      expect(mockApplyPayment).toHaveBeenCalledWith("user-alice", {
        provider: "stripe",
        amount_cents: 5000,
        reconciled_via: "stripe_webhook_cs_test_ABC123",
      });
      expect(mockRecordDonation).not.toHaveBeenCalled();
    });

    it("returns 200 (drop) when session has no metadata.owner_sub", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_missing_meta",
            amount_total: 5000,
            metadata: { donation_type: "bib" },
          },
        },
      });
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
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
            metadata: {
              donation_type: "bib",
              owner_sub: "user-orphan",
            },
          },
        },
      });
      mockApplyPayment.mockRejectedValue(
        new Error("No bib found for ownerSub=user-orphan")
      );
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
    });

    it("returns 500 when applyPayment throws a non-not-found error (Stripe retries)", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_ddb_failure",
            amount_total: 5000,
            metadata: {
              donation_type: "bib",
              owner_sub: "user-bob",
            },
          },
        },
      });
      mockApplyPayment.mockRejectedValue(new Error("DDB throttled"));
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
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
            metadata: {
              donation_type: "bib",
              owner_sub: "user-carol",
            },
          },
        },
      });
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      expect(mockApplyPayment).not.toHaveBeenCalled();
    });
  });

  describe("donation_type=general branch (Phase 22-05)", () => {
    it("calls recordDonation with the Stripe session id + owner_sub (200)", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_GEN1",
            amount_total: 7500,
            metadata: {
              donation_type: "general",
              owner_sub: "user-dave",
            },
          },
        },
      });
      mockRecordDonation.mockResolvedValue({
        donationId: "stripe:cs_test_GEN1",
        amountCents: 7500,
      });

      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      expect(mockRecordDonation).toHaveBeenCalledTimes(1);
      expect(mockRecordDonation).toHaveBeenCalledWith({
        donationId: "stripe:cs_test_GEN1",
        ownerSub: "user-dave",
        amountCents: 7500,
        provider: "stripe",
        stripeSessionId: "cs_test_GEN1",
        reconciledVia: "stripe_webhook_cs_test_GEN1",
      });
      expect(mockApplyPayment).not.toHaveBeenCalled();
    });

    it("records with ownerSub=null when metadata.owner_sub is missing (v1.6 anon-support path)", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_GEN2",
            amount_total: 500,
            metadata: {
              donation_type: "general",
              // no owner_sub — entity layer accepts null.
            },
          },
        },
      });
      mockRecordDonation.mockResolvedValue({});

      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      const call = mockRecordDonation.mock.calls[0][0];
      expect(call.ownerSub).toBeNull();
    });

    it("returns 200 (drop) when amount_total is 0", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_GEN3",
            amount_total: 0,
            metadata: {
              donation_type: "general",
              owner_sub: "user-eve",
            },
          },
        },
      });
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      expect(mockRecordDonation).not.toHaveBeenCalled();
    });

    it("returns 500 when recordDonation throws (Stripe retries)", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_GEN4",
            amount_total: 1000,
            metadata: {
              donation_type: "general",
              owner_sub: "user-fred",
            },
          },
        },
      });
      mockRecordDonation.mockRejectedValue(new Error("DDB throttled"));
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("donation_record_failed");
    });
  });

  describe("unknown / missing donation_type (Phase 22-05)", () => {
    it("returns 200 without touching either entity when donation_type is missing", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_UNKNOWN1",
            amount_total: 1000,
            metadata: { owner_sub: "user-grace" },
          },
        },
      });
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      expect(mockApplyPayment).not.toHaveBeenCalled();
      expect(mockRecordDonation).not.toHaveBeenCalled();
    });

    it("returns 200 without touching either entity when donation_type is an unknown value", async () => {
      mockConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_UNKNOWN2",
            amount_total: 1000,
            metadata: {
              donation_type: "somefuturetype",
              owner_sub: "user-heidi",
            },
          },
        },
      });
      const req = makeRequest({ signature: "t=1,v1=ok", body: "{}" });
      const res = await POST(
        req as unknown as import("next/server").NextRequest
      );
      expect(res.status).toBe(200);
      expect(mockApplyPayment).not.toHaveBeenCalled();
      expect(mockRecordDonation).not.toHaveBeenCalled();
    });
  });
});
