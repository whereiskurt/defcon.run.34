import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 22-05-01 tests: `willPayInPerson` field + entity helper.
 *
 * Covers `updateBibWillPayInPerson()` — the ElectroDB-backed setter used by
 * PATCH /api/bib to persist the pledge flag. Mocks Entity + client so the
 * SUT can be exercised without booting DDB.
 *
 * Scenarios:
 *   - Sets willPayInPerson=true when caller passes true.
 *   - Sets willPayInPerson=false when caller passes false.
 *   - Throws when no bib exists.
 *   - Applies the write EVEN when nameLocked=true (pledge is orthogonal).
 */

const mockGet = vi.fn();
const mockPatch = vi.fn();

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
      const chain = {
        setPayload: {} as Record<string, unknown>,
        set(payload: Record<string, unknown>) {
          this.setPayload = payload;
          return this;
        },
        add(_p: Record<string, unknown>) {
          return this;
        },
        append(_p: Record<string, unknown>) {
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

import { updateBibWillPayInPerson } from "@/entities/bib";

describe("updateBibWillPayInPerson()", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  const bibFixture = (overrides?: Record<string, unknown>) => ({
    ownerSub: "user-1",
    nameOnBib: "Alice",
    runnerCode: "BIB-ABCD",
    paidAmount: 0,
    paidStatusHistory: [],
    nameLocked: false,
    willPayInPerson: false,
    ...overrides,
  });

  it("sets willPayInPerson=true and returns the updated bib", async () => {
    mockGet.mockResolvedValue({ data: bibFixture() });
    mockPatch.mockResolvedValue({
      data: bibFixture({ willPayInPerson: true }),
    });

    const result = await updateBibWillPayInPerson("user-1", true);

    expect(result.willPayInPerson).toBe(true);
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const [key, chain] = mockPatch.mock.calls[0] as unknown as [
      { ownerSub: string },
      { setPayload: Record<string, unknown> },
    ];
    expect(key).toEqual({ ownerSub: "user-1" });
    expect(chain.setPayload).toEqual({ willPayInPerson: true });
  });

  it("sets willPayInPerson=false when caller passes false", async () => {
    mockGet.mockResolvedValue({
      data: bibFixture({ willPayInPerson: true }),
    });
    mockPatch.mockResolvedValue({
      data: bibFixture({ willPayInPerson: false }),
    });

    await updateBibWillPayInPerson("user-1", false);

    const chain = mockPatch.mock.calls[0][1] as {
      setPayload: Record<string, unknown>;
    };
    expect(chain.setPayload).toEqual({ willPayInPerson: false });
  });

  it("throws when no bib exists for the given owner", async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(
      updateBibWillPayInPerson("nobody", true)
    ).rejects.toThrow(/No bib found for ownerSub=nobody/);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("applies the write even when nameLocked=true (pledge is orthogonal)", async () => {
    // Phase 22-05 contract: the pledge is separate from print gating.
    // A locked-name bib can still toggle the pledge (participant changes
    // their mind about paying online vs. in-person after nameLocked is set).
    mockGet.mockResolvedValue({
      data: bibFixture({ nameLocked: true }),
    });
    mockPatch.mockResolvedValue({
      data: bibFixture({ nameLocked: true, willPayInPerson: true }),
    });

    const result = await updateBibWillPayInPerson("user-1", true);
    expect(result.willPayInPerson).toBe(true);
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});
