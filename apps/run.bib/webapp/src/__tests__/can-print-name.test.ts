import { describe, it, expect, vi } from "vitest";

/**
 * Plan 22-05-01 tests: canPrintName gate (rescoped from Plan 22-04-3).
 *
 * Phase 22-05 rescope (Kurt 2026-07-02): bib registration is FREE. The
 * former `paidAmount >= 1000` check was DROPPED — the print gate is now
 * `nameLocked === true` alone. Payment is orthogonal.
 *
 * These tests replace the earlier Plan 22-04 assertions that required BOTH
 * `paidAmount >= 1000` AND `nameLocked` — those semantics are gone.
 *
 * Mocks ElectroDB + client the same way runner-code.test.ts +
 * budget-counter.test.ts do — the SUT touches Entity at module load, and
 * we bypass the AWS credential lookup by replacing the Entity constructor
 * with a stub.
 *
 * Coverage:
 *   - nameLocked=true → true (regardless of paidAmount, willPayInPerson)
 *   - nameLocked=false → false (regardless of paidAmount, willPayInPerson)
 *   - null / undefined bib → false
 *   - Free-print scenario: paidAmount=0, willPayInPerson=false, nameLocked=true → true
 *   - Free-print scenario: paidAmount=0, willPayInPerson=true, nameLocked=true → true
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

import { canPrintName } from "@/entities/bib";

describe("canPrintName() — Phase 22-05 free-bib rescope", () => {
  const base = {
    ownerSub: "sub-1",
    nameOnBib: "Alice",
    runnerCode: "BIB-K7QM",
    paidAmount: 0,
    paidStatusHistory: [],
    nameLocked: true,
    willPayInPerson: false,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };

  it("returns true when nameLocked=true (payment orthogonal)", () => {
    expect(canPrintName(base)).toBe(true);
  });

  it("returns true when nameLocked=true and paidAmount=0 (free bib)", () => {
    expect(canPrintName({ ...base, paidAmount: 0 })).toBe(true);
  });

  it("returns true when nameLocked=true and paidAmount>0 (sponsor path)", () => {
    expect(canPrintName({ ...base, paidAmount: 2500 })).toBe(true);
  });

  it("returns true regardless of willPayInPerson pledge (payment orthogonal)", () => {
    expect(canPrintName({ ...base, willPayInPerson: true })).toBe(true);
    expect(canPrintName({ ...base, willPayInPerson: false })).toBe(true);
  });

  it("returns false when nameLocked=false (admin has not confirmed)", () => {
    expect(canPrintName({ ...base, nameLocked: false })).toBe(false);
  });

  it("returns false when nameLocked=false even with a large payment", () => {
    expect(
      canPrintName({ ...base, nameLocked: false, paidAmount: 100_000 })
    ).toBe(false);
  });

  it("returns false for null / undefined input", () => {
    expect(canPrintName(null)).toBe(false);
    expect(canPrintName(undefined)).toBe(false);
  });
});
