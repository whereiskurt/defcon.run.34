import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * budget-counter.ts unit tests (Plan 22-03-4).
 *
 * We mock ElectroDB's Entity here — same reasoning as runner-code.test.ts:
 * the Entity constructor touches @aws-sdk/* + AWS credentials at module
 * load. We swap in a controllable double so the tests exercise the
 * checkBudget / incrementBudget / todayUtcKey logic without spinning up
 * DynamoDB or mocking the AWS SDK.
 */

// -- Mocks must come before the SUT import ---------------------------------

const mockGet = vi.fn();
const mockUpsert = vi.fn();

// The SUT imports `Entity` from electrodb and constructs one at module
// load — mock the module surface to return an object with the get() +
// upsert() shape the SUT calls. Also mock the client module so it
// doesn't try to read AWS credentials from env at test time.
vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {
      // no-op; the SUT never calls methods on `new Entity()` directly —
      // it stores the instance in a module-level `BudgetCounter` export
      // and calls .get() / .upsert() on that.
    }
    get(_key: unknown) {
      return { go: () => mockGet(_key) };
    }
    upsert(_key: unknown) {
      // upsert().add().go() chain
      return {
        add: (delta: Record<string, number>) => ({
          go: (opts?: unknown) => mockUpsert(_key, delta, opts),
        }),
      };
    }
  }
  return { Entity };
});

vi.mock("@/entities/client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro-mock",
}));

// Import after mocks are registered.
import {
  DAILY_BUDGET_CAP_CENTS,
  checkBudget,
  incrementBudget,
  todayUtcKey,
} from "@/entities/budget-counter";

// -- Tests -----------------------------------------------------------------

describe("todayUtcKey()", () => {
  it("returns YYYY-MM-DD in UTC regardless of local tz", () => {
    // 2026-07-02 23:30 UTC — should never roll to next day even if the
    // test runner is in +14 timezone.
    const d = new Date(Date.UTC(2026, 6, 2, 23, 30, 0));
    expect(todayUtcKey(d)).toBe("2026-07-02");
  });

  it("rolls at UTC midnight, not local midnight", () => {
    const d = new Date(Date.UTC(2026, 6, 3, 0, 0, 1));
    expect(todayUtcKey(d)).toBe("2026-07-03");
  });

  it("defaults to `new Date()` when no arg supplied", () => {
    const key = todayUtcKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("DAILY_BUDGET_CAP_CENTS", () => {
  it("is pinned at $20/day (2000 cents) per AI-SPEC §Budget-Cap Strategy", () => {
    expect(DAILY_BUDGET_CAP_CENTS).toBe(2000);
  });
});

describe("checkBudget()", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpsert.mockReset();
  });

  it("returns allowed=true, spentCents=0 when no row exists yet (first call of day)", async () => {
    mockGet.mockResolvedValue({ data: null });
    const result = await checkBudget("2026-07-02");
    expect(result).toEqual({
      allowed: true,
      spentCents: 0,
      capCents: 2000,
    });
    expect(mockGet).toHaveBeenCalledWith({ date: "2026-07-02" });
  });

  it("returns allowed=true when spentCents is below the cap", async () => {
    mockGet.mockResolvedValue({
      data: { date: "2026-07-02", costUsdCents: 1999, invocationCount: 1999 },
    });
    const result = await checkBudget("2026-07-02");
    expect(result.allowed).toBe(true);
    expect(result.spentCents).toBe(1999);
    expect(result.capCents).toBe(2000);
  });

  it("returns allowed=false EXACTLY at the cap (>=, not >)", async () => {
    // Guardrail — a naive `>` check would let the row spend 2001 cents
    // before short-circuiting. The plan's contract is "$20/day hard cap
    // check" so ≥2000 must block.
    mockGet.mockResolvedValue({
      data: { date: "2026-07-02", costUsdCents: 2000, invocationCount: 2000 },
    });
    const result = await checkBudget("2026-07-02");
    expect(result.allowed).toBe(false);
    expect(result.spentCents).toBe(2000);
  });

  it("returns allowed=false when spentCents is above the cap", async () => {
    mockGet.mockResolvedValue({
      data: { date: "2026-07-02", costUsdCents: 5000, invocationCount: 5000 },
    });
    const result = await checkBudget("2026-07-02");
    expect(result.allowed).toBe(false);
    expect(result.spentCents).toBe(5000);
    expect(result.capCents).toBe(2000);
  });

  it("treats an existing row with no costUsdCents attribute as 0 (ElectroDB default default)", async () => {
    mockGet.mockResolvedValue({
      data: { date: "2026-07-02", invocationCount: 0 },
    });
    const result = await checkBudget("2026-07-02");
    expect(result.spentCents).toBe(0);
    expect(result.allowed).toBe(true);
  });
});

describe("incrementBudget()", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpsert.mockReset();
  });

  it("upserts + ADDs the delta and a single invocationCount tick", async () => {
    mockUpsert.mockResolvedValue({
      data: {
        date: "2026-07-02",
        costUsdCents: 100,
        invocationCount: 1,
      },
    });
    const result = await incrementBudget("2026-07-02", 100);
    expect(result.costUsdCents).toBe(100);
    expect(result.invocationCount).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      { date: "2026-07-02" },
      { costUsdCents: 100, invocationCount: 1 },
      { response: "all_new" }
    );
  });

  it("clamps a negative delta to 0 (never reduces the counter)", async () => {
    mockUpsert.mockResolvedValue({
      data: { date: "2026-07-02", costUsdCents: 0, invocationCount: 1 },
    });
    await incrementBudget("2026-07-02", -50);
    expect(mockUpsert).toHaveBeenCalledWith(
      { date: "2026-07-02" },
      { costUsdCents: 0, invocationCount: 1 },
      { response: "all_new" }
    );
  });

  it("truncates a fractional delta to whole cents (DDB Number is decimal-lossy)", async () => {
    mockUpsert.mockResolvedValue({
      data: { date: "2026-07-02", costUsdCents: 1, invocationCount: 1 },
    });
    await incrementBudget("2026-07-02", 1.9);
    expect(mockUpsert).toHaveBeenCalledWith(
      { date: "2026-07-02" },
      { costUsdCents: 1, invocationCount: 1 },
      { response: "all_new" }
    );
  });

  it("is idempotent-safe: two calls to add({N: 1}) produce ADD 1 + ADD 1 (monotonic on DDB)", async () => {
    // Not a live-DDB test — just documenting the contract: each call
    // issues a single UpdateItem with an ADD action. Two successive
    // calls for the same date sum on the server, not the client.
    mockUpsert
      .mockResolvedValueOnce({
        data: { date: "2026-07-02", costUsdCents: 100, invocationCount: 1 },
      })
      .mockResolvedValueOnce({
        data: { date: "2026-07-02", costUsdCents: 200, invocationCount: 2 },
      });

    const first = await incrementBudget("2026-07-02", 100);
    const second = await incrementBudget("2026-07-02", 100);

    expect(first.invocationCount).toBe(1);
    expect(second.invocationCount).toBe(2);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    // Both calls send the same delta (add 100) — the DDB server does the
    // summing. This is the load-bearing correctness property for the
    // Haiku budget cap in a concurrent Lambda world.
    expect(mockUpsert.mock.calls[0][1]).toEqual({
      costUsdCents: 100,
      invocationCount: 1,
    });
    expect(mockUpsert.mock.calls[1][1]).toEqual({
      costUsdCents: 100,
      invocationCount: 1,
    });
  });
});
