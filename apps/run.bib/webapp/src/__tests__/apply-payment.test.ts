import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * applyPayment() unit tests (Plan 22-01-4).
 *
 * The load-bearing invariant here is idempotency-by-reconciled_via so
 * Stripe webhook retries fire the SAME session id without
 * double-crediting `Bib.paidAmount`. We mock ElectroDB's Entity + the
 * client module so the SUT exercises the read → dedup → conditional
 * append path against a controllable double.
 */

const mockGet = vi.fn();
const mockPatch = vi.fn();

// The SUT (`entities/bib.ts`) constructs an Entity at module load. We
// swap the Entity class for a controllable double so vitest can pin
// the read/write shape without spinning up DynamoDB.
vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {}
    get(key: unknown) {
      return { go: () => mockGet(key) };
    }
    query = {
      byRunnerCode: (_key: unknown) => ({
        go: async () => ({ data: [] }),
      }),
    };
    create(_input: unknown) {
      return { go: () => Promise.resolve({ data: null }) };
    }
    patch(key: unknown) {
      // Chain shape: .patch(key).add({...}).append({...}).go({...})
      const chain = {
        setPayload: {} as Record<string, unknown>,
        addPayload: {} as Record<string, unknown>,
        appendPayload: {} as Record<string, unknown>,
        set(payload: Record<string, unknown>) {
          this.setPayload = payload;
          return this;
        },
        add(payload: Record<string, unknown>) {
          this.addPayload = payload;
          return this;
        },
        append(payload: Record<string, unknown>) {
          this.appendPayload = payload;
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

// applyPayment provisions a run.human identity for the payer (fail-open network
// side-effect) — mock it so the unit test stays offline + can assert the hook.
const { mockEnsure } = vi.hoisted(() => ({ mockEnsure: vi.fn() }));
vi.mock("@/lib/rabbit-name-sync", () => ({
  ensureRunHumanProfile: (...a: unknown[]) => mockEnsure(...a),
}));

// Import after mocks are registered.
import { applyPayment } from "@/entities/bib";

describe("applyPayment()", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockEnsure.mockReset();
  });

  it("throws when the bib does not exist for the owner", async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(
      applyPayment("nobody", {
        provider: "stripe",
        amount_cents: 2500,
        reconciled_via: "stripe_webhook_cs_test_1",
      })
    ).rejects.toThrow(/No bib found for ownerSub=nobody/);
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("appends the history row + ADDs paidAmount on first application", async () => {
    mockGet.mockResolvedValue({
      data: {
        ownerSub: "user-1",
        runnerCode: "BIB-ABCD",
        paidAmount: 0,
        paidStatusHistory: [],
      },
    });
    mockPatch.mockResolvedValue({
      data: {
        ownerSub: "user-1",
        runnerCode: "BIB-ABCD",
        paidAmount: 2500,
        paidStatusHistory: [
          {
            provider: "stripe",
            amount: 2500,
            timestamp: "2026-07-02T15:00:00.000Z",
            reconciled_via: "stripe_webhook_cs_test_1",
          },
        ],
      },
    });

    const result = await applyPayment("user-1", {
      provider: "stripe",
      amount_cents: 2500,
      reconciled_via: "stripe_webhook_cs_test_1",
      timestamp: "2026-07-02T15:00:00.000Z",
    });

    expect(result.paidAmount).toBe(2500);
    expect(mockPatch).toHaveBeenCalledTimes(1);
    // The payer is provisioned a run.human identity on this fresh application.
    expect(mockEnsure).toHaveBeenCalledWith("user-1");
    const [key, chain, opts] = mockPatch.mock.calls[0] as unknown as [
      { ownerSub: string },
      { addPayload: Record<string, unknown>; appendPayload: Record<string, unknown> },
      unknown,
    ];
    expect(key).toEqual({ ownerSub: "user-1" });
    expect(chain.addPayload).toEqual({ paidAmount: 2500 });
    expect(chain.appendPayload).toEqual({
      paidStatusHistory: [
        {
          provider: "stripe",
          amount: 2500,
          timestamp: "2026-07-02T15:00:00.000Z",
          reconciled_via: "stripe_webhook_cs_test_1",
        },
      ],
    });
    expect(opts).toEqual({ response: "all_new" });
  });

  it("is idempotent: repeat calls with the same reconciled_via no-op", async () => {
    const bibWithHistory = {
      ownerSub: "user-2",
      runnerCode: "BIB-EFGH",
      paidAmount: 2500,
      paidStatusHistory: [
        {
          provider: "stripe",
          amount: 2500,
          timestamp: "2026-07-02T15:00:00.000Z",
          reconciled_via: "stripe_webhook_cs_test_2",
        },
      ],
    };
    mockGet.mockResolvedValue({ data: bibWithHistory });

    // Second webhook delivery for the same Stripe session — SUT must
    // detect the marker and short-circuit without a patch call.
    const result = await applyPayment("user-2", {
      provider: "stripe",
      amount_cents: 2500,
      reconciled_via: "stripe_webhook_cs_test_2",
      timestamp: "2026-07-02T15:10:00.000Z",
    });

    expect(result).toBe(bibWithHistory);
    expect(mockPatch).not.toHaveBeenCalled();
    // Idempotent short-circuit → no re-provision on webhook retries.
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("truncates fractional cents to whole cents (Stripe amount_total is int)", async () => {
    mockGet.mockResolvedValue({
      data: {
        ownerSub: "user-3",
        runnerCode: "BIB-JKLM",
        paidAmount: 0,
        paidStatusHistory: [],
      },
    });
    mockPatch.mockResolvedValue({
      data: {
        ownerSub: "user-3",
        runnerCode: "BIB-JKLM",
        paidAmount: 2599,
        paidStatusHistory: [{ amount: 2599 }],
      },
    });

    await applyPayment("user-3", {
      provider: "stripe",
      amount_cents: 2599.9, // Should never happen with Stripe but defensive.
      reconciled_via: "stripe_webhook_cs_test_3",
      timestamp: "2026-07-02T15:00:00.000Z",
    });

    const chain = mockPatch.mock.calls[0][1] as {
      addPayload: Record<string, number>;
    };
    expect(chain.addPayload.paidAmount).toBe(2599);
  });

  it("clamps a negative amount_cents to 0 (never reduces paidAmount)", async () => {
    mockGet.mockResolvedValue({
      data: {
        ownerSub: "user-4",
        runnerCode: "BIB-NOPQ",
        paidAmount: 1000,
        paidStatusHistory: [],
      },
    });
    mockPatch.mockResolvedValue({
      data: { ownerSub: "user-4" },
    });

    await applyPayment("user-4", {
      provider: "stripe",
      amount_cents: -500,
      reconciled_via: "stripe_webhook_cs_test_4",
    });

    const chain = mockPatch.mock.calls[0][1] as {
      addPayload: Record<string, number>;
    };
    expect(chain.addPayload.paidAmount).toBe(0);
  });

  it("stamps a fresh ISO8601 timestamp when caller omits `timestamp`", async () => {
    mockGet.mockResolvedValue({
      data: {
        ownerSub: "user-5",
        runnerCode: "BIB-RSTU",
        paidAmount: 0,
        paidStatusHistory: [],
      },
    });
    mockPatch.mockResolvedValue({
      data: { ownerSub: "user-5" },
    });

    const before = new Date().toISOString();
    await applyPayment("user-5", {
      provider: "stripe",
      amount_cents: 100,
      reconciled_via: "stripe_webhook_cs_test_5",
    });
    const after = new Date().toISOString();

    const chain = mockPatch.mock.calls[0][1] as {
      appendPayload: { paidStatusHistory: Array<{ timestamp: string }> };
    };
    const stamped = chain.appendPayload.paidStatusHistory[0].timestamp;
    expect(stamped >= before && stamped <= after).toBe(true);
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
