import { describe, it, expect, vi } from "vitest";

/**
 * Plan 22-04-3 tests: canPrintName gate (SC8).
 *
 * Mocks ElectroDB + client the same way runner-code.test.ts +
 * budget-counter.test.ts do — the SUT touches Entity at module load, and
 * we bypass the AWS credential lookup by replacing the Entity constructor
 * with a stub.
 *
 * Coverage:
 *   - Both conditions true → true
 *   - paidAmount below cap → false
 *   - nameLocked false → false
 *   - Both false → false
 *   - null / undefined bib → false
 *   - PRINT_PAID_MIN_CENTS pinned at 1000
 */

// Mock ElectroDB Entity before importing the SUT.
vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {}
    get(_k: unknown) {
      return { go: async () => ({ data: null }) };
    }
    query = {
      byRunnerCode: (_k: unknown) => ({ go: async () => ({ data: [] }) }),
    };
    create(_input: unknown) {
      return { go: async () => ({ data: {} }) };
    }
    patch(_k: unknown) {
      return { set: (_v: unknown) => ({ go: async () => ({ data: {} }) }) };
    }
  }
  return { Entity };
});

vi.mock("@/entities/client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro-mock",
}));

import { canPrintName, PRINT_PAID_MIN_CENTS } from "@/entities/bib";

describe("canPrintName()", () => {
  const base = {
    ownerSub: "sub-1",
    nameOnBib: "Alice",
    runnerCode: "BIB-K7QM",
    paidAmount: 1000,
    paidStatusHistory: [],
    nameLocked: true,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };

  it("returns true when paidAmount >= 1000 and nameLocked=true", () => {
    expect(canPrintName(base)).toBe(true);
  });

  it("returns true at EXACTLY the $10 threshold", () => {
    expect(canPrintName({ ...base, paidAmount: 1000 })).toBe(true);
  });

  it("returns true above the threshold ($20 sponsor)", () => {
    expect(canPrintName({ ...base, paidAmount: 2000 })).toBe(true);
  });

  it("returns false when paidAmount is below the threshold", () => {
    expect(canPrintName({ ...base, paidAmount: 999 })).toBe(false);
    expect(canPrintName({ ...base, paidAmount: 0 })).toBe(false);
  });

  it("returns false when nameLocked is false (admin has not confirmed)", () => {
    expect(canPrintName({ ...base, nameLocked: false })).toBe(false);
  });

  it("returns false when BOTH conditions fail", () => {
    expect(
      canPrintName({ ...base, paidAmount: 500, nameLocked: false })
    ).toBe(false);
  });

  it("returns false for null / undefined input", () => {
    expect(canPrintName(null)).toBe(false);
    expect(canPrintName(undefined)).toBe(false);
  });

  it("PRINT_PAID_MIN_CENTS is pinned at 1000 (=$10)", () => {
    expect(PRINT_PAID_MIN_CENTS).toBe(1000);
  });
});
