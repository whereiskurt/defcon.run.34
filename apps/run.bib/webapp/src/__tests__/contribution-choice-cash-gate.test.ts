import { describe, it, expect } from "vitest";
import { planSelect } from "@/components/ContributionChoice";

/**
 * ⑤ (2026-07-08) — the pay-in-person pledge is gated behind a Signal-confirm
 * modal. `planSelect` is the pure decision: pay-in-person defers to the modal;
 * every other pick applies immediately. (The modal itself is portal/client-only
 * and not SSR-testable; this pins the branching logic in the node env.)
 */
describe("planSelect — cash-gate decision", () => {
  it("gates pay-in-person behind the cash modal", () => {
    expect(planSelect("inperson", "nothing")).toEqual({ kind: "open-cash-modal" });
    expect(planSelect("inperson", "burn")).toEqual({ kind: "open-cash-modal" });
  });

  it("applies burn / nothing immediately (no modal)", () => {
    expect(planSelect("burn", "nothing")).toEqual({ kind: "apply", choice: "burn" });
    expect(planSelect("nothing", "inperson")).toEqual({ kind: "apply", choice: "nothing" });
    expect(planSelect("nothing", "burn")).toEqual({ kind: "apply", choice: "nothing" });
  });

  it("no-ops when the pick is unchanged", () => {
    expect(planSelect("burn", "burn")).toBeNull();
    expect(planSelect("inperson", "inperson")).toBeNull();
    expect(planSelect("nothing", "nothing")).toBeNull();
  });
});
