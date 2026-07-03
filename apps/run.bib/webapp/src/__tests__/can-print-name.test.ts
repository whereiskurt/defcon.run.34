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

describe("canPrintName() — Kurt 2026-07-03 $20-bib-spend gate", () => {
  // Prints iff paidAmount >= $20 (2000c) AND a non-empty name is set.
  const base = {
    ownerSub: "sub-1",
    nameOnBib: "Alice",
    runnerCode: "BIB-K7QM",
    paidAmount: 2000,
    paidStatusHistory: [],
    nameLocked: false,
    willPayInPerson: false,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };

  it("true when paid >= $20 with a name", () => {
    expect(canPrintName(base)).toBe(true);
    expect(canPrintName({ ...base, paidAmount: 5000 })).toBe(true);
  });

  it("true at exactly $20 (the bib minimum)", () => {
    expect(canPrintName({ ...base, paidAmount: 2000 })).toBe(true);
  });

  it("false below $20 even with a name", () => {
    expect(canPrintName({ ...base, paidAmount: 1999 })).toBe(false);
    expect(canPrintName({ ...base, paidAmount: 0 })).toBe(false);
  });

  it("false when no name even if paid over $20", () => {
    expect(canPrintName({ ...base, nameOnBib: "" })).toBe(false);
    expect(canPrintName({ ...base, nameOnBib: "   " })).toBe(false);
  });

  it("nameLocked alone does not print — the $20 payment gate applies", () => {
    expect(canPrintName({ ...base, paidAmount: 0, nameLocked: true })).toBe(false);
  });

  it("returns false for null / undefined input", () => {
    expect(canPrintName(null)).toBe(false);
    expect(canPrintName(undefined)).toBe(false);
  });
});
