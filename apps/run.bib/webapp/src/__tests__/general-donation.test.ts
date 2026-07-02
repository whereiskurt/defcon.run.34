import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 22-05-02 tests: GeneralDonation entity + helpers.
 *
 * The load-bearing invariants:
 *   - `recordDonation` is IDEMPOTENT by donationId — Stripe fires the
 *     SAME session id on retry, and the second create must return the
 *     existing row without a new write.
 *   - `stripeSessionDonationId` prefixes with `stripe:` so future venmo/
 *     cashapp keys don't collide.
 *   - Amount clamped to non-negative whole cents.
 *   - Anonymous rows (ownerSub=null) are permitted at the entity layer.
 */

const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockScan = vi.fn();

vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {}
    get(key: unknown) {
      return { go: () => mockGet(key) };
    }
    create(input: unknown) {
      return { go: () => mockCreate(input) };
    }
    scan = {
      where: (_fn: unknown) => ({
        go: () => mockScan(),
      }),
    };
  }
  return { Entity };
});

vi.mock("@/entities/client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro-mock",
}));

import {
  getDonation,
  listDonationsForOwner,
  recordDonation,
  stripeSessionDonationId,
} from "@/entities/general-donation";

describe("stripeSessionDonationId()", () => {
  it("prefixes the Stripe session id with 'stripe:'", () => {
    expect(stripeSessionDonationId("cs_test_1234")).toBe("stripe:cs_test_1234");
  });

  it("is deterministic (same input → same output)", () => {
    const a = stripeSessionDonationId("cs_live_ABC");
    const b = stripeSessionDonationId("cs_live_ABC");
    expect(a).toBe(b);
  });
});

describe("recordDonation()", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockGet.mockReset();
    mockScan.mockReset();
  });

  it("creates a new donation row on first write and returns it", async () => {
    const row = {
      donationId: "stripe:cs_test_A",
      ownerSub: "user-1",
      amountCents: 2500,
      provider: "stripe",
      stripeSessionId: "cs_test_A",
      reconciledVia: "stripe_webhook_cs_test_A",
      createdAt: "2026-07-02T15:00:00.000Z",
    };
    mockCreate.mockResolvedValue({ data: row });

    const result = await recordDonation({
      donationId: "stripe:cs_test_A",
      ownerSub: "user-1",
      amountCents: 2500,
      provider: "stripe",
      stripeSessionId: "cs_test_A",
      reconciledVia: "stripe_webhook_cs_test_A",
    });

    expect(result).toEqual(row);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [payload] = mockCreate.mock.calls[0];
    expect(payload).toEqual({
      donationId: "stripe:cs_test_A",
      ownerSub: "user-1",
      amountCents: 2500,
      provider: "stripe",
      stripeSessionId: "cs_test_A",
      reconciledVia: "stripe_webhook_cs_test_A",
    });
  });

  it("is idempotent: same stripeSessionId → returns existing row, no new write", async () => {
    // First .create() fires the ConditionalCheckFailedException path — we
    // catch it and fall through to getDonation() which returns the row.
    const existing = {
      donationId: "stripe:cs_test_B",
      ownerSub: "user-2",
      amountCents: 5000,
      provider: "stripe",
      stripeSessionId: "cs_test_B",
      reconciledVia: "stripe_webhook_cs_test_B",
      createdAt: "2026-07-02T14:00:00.000Z",
    };
    const conditionalErr = new Error("ConditionalCheckFailedException");
    conditionalErr.name = "ConditionalCheckFailedException";
    mockCreate.mockRejectedValue(conditionalErr);
    mockGet.mockResolvedValue({ data: existing });

    const result = await recordDonation({
      donationId: "stripe:cs_test_B",
      ownerSub: "user-2",
      amountCents: 5000,
      provider: "stripe",
      stripeSessionId: "cs_test_B",
      reconciledVia: "stripe_webhook_cs_test_B",
    });

    expect(result).toEqual(existing);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // getDonation() re-reads the row on the dedup path.
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("clamps negative amount to 0", async () => {
    mockCreate.mockResolvedValue({
      data: { donationId: "stripe:cs_test_C", amountCents: 0 },
    });

    await recordDonation({
      donationId: "stripe:cs_test_C",
      ownerSub: "user-3",
      amountCents: -100,
      provider: "stripe",
      stripeSessionId: "cs_test_C",
      reconciledVia: "stripe_webhook_cs_test_C",
    });

    const [payload] = mockCreate.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(payload.amountCents).toBe(0);
  });

  it("truncates fractional cents to whole cents", async () => {
    mockCreate.mockResolvedValue({
      data: { donationId: "stripe:cs_test_D", amountCents: 2599 },
    });

    await recordDonation({
      donationId: "stripe:cs_test_D",
      ownerSub: "user-4",
      amountCents: 2599.99,
      provider: "stripe",
      stripeSessionId: "cs_test_D",
      reconciledVia: "stripe_webhook_cs_test_D",
    });

    const [payload] = mockCreate.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(payload.amountCents).toBe(2599);
  });

  it("omits ownerSub from the payload when the caller passes null", async () => {
    // Anonymous donation path: caller passes null; the entity attribute is
    // optional and ElectroDB rejects literal `undefined`. Payload must not
    // include the key at all.
    mockCreate.mockResolvedValue({
      data: { donationId: "stripe:cs_test_E", amountCents: 500 },
    });

    await recordDonation({
      donationId: "stripe:cs_test_E",
      ownerSub: null,
      amountCents: 500,
      provider: "stripe",
      stripeSessionId: "cs_test_E",
      reconciledVia: "stripe_webhook_cs_test_E",
    });

    const [payload] = mockCreate.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(payload.ownerSub).toBeUndefined();
    expect("ownerSub" in payload).toBe(false);
  });

  it("re-throws non-ConditionalCheckFailed errors from create", async () => {
    const boom = new Error("network is down");
    mockCreate.mockRejectedValue(boom);

    await expect(
      recordDonation({
        donationId: "stripe:cs_test_F",
        ownerSub: "user-6",
        amountCents: 100,
        provider: "stripe",
        stripeSessionId: "cs_test_F",
        reconciledVia: "stripe_webhook_cs_test_F",
      })
    ).rejects.toThrow(/network is down/);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("getDonation()", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("returns null when the row does not exist", async () => {
    mockGet.mockResolvedValue({ data: null });
    const result = await getDonation("stripe:missing");
    expect(result).toBeNull();
  });

  it("returns the row when it exists", async () => {
    const row = { donationId: "stripe:x", amountCents: 100 };
    mockGet.mockResolvedValue({ data: row });
    const result = await getDonation("stripe:x");
    expect(result).toEqual(row);
  });
});

describe("listDonationsForOwner()", () => {
  beforeEach(() => {
    mockScan.mockReset();
  });

  it("returns the scan result data for the ownerSub filter", async () => {
    mockScan.mockResolvedValue({
      data: [
        { donationId: "stripe:a", ownerSub: "user-1", amountCents: 100 },
        { donationId: "stripe:b", ownerSub: "user-1", amountCents: 200 },
      ],
    });

    const result = await listDonationsForOwner("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].donationId).toBe("stripe:a");
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when the owner has no donations", async () => {
    mockScan.mockResolvedValue({ data: [] });
    const result = await listDonationsForOwner("user-nobody");
    expect(result).toEqual([]);
  });
});
