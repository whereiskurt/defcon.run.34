import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {}
    get(key: unknown) {
      return { go: () => mockGet(key) };
    }
    query = { byRunnerCode: (_k: unknown) => ({ go: async () => ({ data: [] }) }) };
    create(_input: unknown) {
      return { go: () => Promise.resolve({ data: null }) };
    }
    patch(key: unknown) {
      const chain = {
        setPayload: {} as Record<string, unknown>,
        set(payload: Record<string, unknown>) {
          this.setPayload = payload;
          return this;
        },
        go(opts?: unknown) {
          return mockPatch(key, this, opts);
        },
      };
      return chain;
    }
  }
  return { Entity };
});

vi.mock("@/entities/client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro-mock",
}));

import { reverseCashPayment } from "@/entities/bib";

const CASH = {
  provider: "cash",
  amount: 2000,
  timestamp: "2026-07-11T22:01:06.000Z",
  reconciled_via: "admin_inperson_cash_user-ogre",
};
const STRIPE = {
  provider: "stripe",
  amount: 2000,
  timestamp: "2026-07-11T22:16:52.000Z",
  reconciled_via: "stripe_webhook_cs_x",
};

describe("reverseCashPayment()", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPatch.mockResolvedValue({ data: {} });
  });

  it("removes only the matching cash entry and decrements paidAmount", async () => {
    mockGet.mockResolvedValue({
      data: { ownerSub: "user-ogre", runnerCode: "BIB-wbbb", paidAmount: 4000, paidStatusHistory: [STRIPE, CASH] },
    });
    const out = await reverseCashPayment("user-ogre", {
      timestamp: CASH.timestamp,
      reconciledVia: CASH.reconciled_via,
    });
    expect(out).toEqual({ reversed: true, amountCents: 2000 });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const [key, chain] = mockPatch.mock.calls[0] as unknown as [
      { ownerSub: string },
      { setPayload: { paidStatusHistory: unknown[]; paidAmount: number } },
    ];
    expect(key).toEqual({ ownerSub: "user-ogre" });
    expect(chain.setPayload.paidAmount).toBe(2000);
    expect(chain.setPayload.paidStatusHistory).toEqual([STRIPE]);
  });

  it("no-ops (no patch) when nothing matches", async () => {
    mockGet.mockResolvedValue({
      data: { ownerSub: "u", runnerCode: "BIB-1", paidAmount: 2000, paidStatusHistory: [CASH] },
    });
    const out = await reverseCashPayment("u", { timestamp: "nope", reconciledVia: "nope" });
    expect(out).toEqual({ reversed: false, amountCents: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("refuses to reverse a non-cash entry even if timestamp+reconciledVia match", async () => {
    mockGet.mockResolvedValue({
      data: { ownerSub: "u", runnerCode: "BIB-1", paidAmount: 2000, paidStatusHistory: [STRIPE] },
    });
    const out = await reverseCashPayment("u", {
      timestamp: STRIPE.timestamp,
      reconciledVia: STRIPE.reconciled_via,
    });
    expect(out).toEqual({ reversed: false, amountCents: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("clamps paidAmount at 0 and returns reversed:false for a missing bib", async () => {
    mockGet.mockResolvedValue({ data: null });
    const out = await reverseCashPayment("ghost", { timestamp: CASH.timestamp, reconciledVia: CASH.reconciled_via });
    expect(out).toEqual({ reversed: false, amountCents: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
