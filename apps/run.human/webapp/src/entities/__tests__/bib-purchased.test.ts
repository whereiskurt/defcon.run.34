import { describe, it, expect } from "vitest";
import { isPurchasedBib } from "../bib";

/**
 * "Did they actually buy a bib" — the gate on both halves of the pickup flow
 * (an operator may only prime a purchased bib; only a purchased bib pays the
 * 200). A `runnerCode` is NOT the answer: every Bib row gets one at create
 * time, so 274 of the 353 live rows on 2026-08-07 were placeholders for people
 * who never bought anything, and treating those as bibs made "Bib ready" the
 * verdict for nearly every operator scan.
 */
describe("isPurchasedBib", () => {
  /**
   * KURT'S CASE (2026-08-07): "anyone who registers a bib NOW with a name isn't
   * eligible". run.bib's BIB_SALES_CLOSED is true, which 403s both the checkout
   * AND any PATCH setting willPayInPerson=true — so a bib created today can
   * only carry a name. That row must never be primeable or awardable, and this
   * is the single line that guarantees it.
   */
  it("a name-only registration made after sales closed is NOT purchased", () => {
    expect(isPurchasedBib({ paidAmount: 0, willPayInPerson: false })).toBe(false);
  });

  it("a bare row with neither field set is NOT purchased", () => {
    expect(isPurchasedBib({})).toBe(false);
  });

  it("money on the bib counts", () => {
    expect(isPurchasedBib({ paidAmount: 2000 })).toBe(true);
  });

  /** Orthogonal to paidAmount — a pledge is a bib to hand over, unpaid or not. */
  it("a pay-at-the-table pledge counts even at paidAmount 0", () => {
    expect(isPurchasedBib({ paidAmount: 0, willPayInPerson: true })).toBe(true);
  });

  it("a refund back to zero drops the bib out again", () => {
    expect(isPurchasedBib({ paidAmount: 0, willPayInPerson: false })).toBe(false);
  });
});
