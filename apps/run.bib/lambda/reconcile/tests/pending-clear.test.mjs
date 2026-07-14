import { describe, it, expect } from "vitest";

/**
 * On a MATCHED email reconcile, the corresponding pending-intent(s) must be
 * cleared — mirroring the admin Approve path — so a bib-tap-then-forward
 * payment leaves the Outstanding list and can't be double-paid via a lingering
 * Approve button. Clearing is best-effort: a cleanup miss must never fail the
 * (already-applied) payment.
 */

import { reconcile } from "../lib/reconcile.mjs";

const matchedDeps = (over = {}) => ({
  createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
  getBibByRunnerCode: async () => null,
  listAllBibs: async () => [
    { ownerSub: "owner-1", nameOnBib: "Bradley Clark", runnerCode: "bib-x" },
  ],
  applyPaymentToBib: async () => ({}),
  updateReconcileStatus: async () => ({}),
  ...over,
});

const extracted = {
  provider: "venmo",
  amount_cents: 5000,
  sender_display_name: "Bradley Clark",
  comment_text: "",
  confidence: "high",
};

describe("reconcile() — clears pending intent on match", () => {
  it("calls clearPendingIntents(ownerSub, provider) once on a matched payment", async () => {
    const calls = [];
    const out = await reconcile({
      receiptId: "mid_a",
      receivedAtMs: 1,
      extracted,
      deps: matchedDeps({
        clearPendingIntents: async (ownerSub, provider) => {
          calls.push({ ownerSub, provider });
        },
      }),
    });

    expect(out.status).toBe("matched");
    expect(out.matchedOwnerSub).toBe("owner-1");
    expect(calls).toEqual([{ ownerSub: "owner-1", provider: "venmo" }]);
  });

  it("is best-effort: a clearPendingIntents failure does not fail the reconcile", async () => {
    const out = await reconcile({
      receiptId: "mid_b",
      receivedAtMs: 1,
      extracted,
      deps: matchedDeps({
        clearPendingIntents: async () => {
          throw new Error("ddb blip");
        },
      }),
    });

    expect(out.status).toBe("matched");
    expect(out.matchedOwnerSub).toBe("owner-1");
  });

  it("does NOT clear pending intents when the payment is unmatched", async () => {
    let called = false;
    const out = await reconcile({
      receiptId: "mid_c",
      receivedAtMs: 1,
      extracted: { ...extracted, sender_display_name: "Nobody Here" },
      deps: matchedDeps({
        listAllBibs: async () => [], // no candidates -> unmatched
        clearPendingIntents: async () => {
          called = true;
        },
      }),
    });

    expect(out.status).toBe("unmatched");
    expect(called).toBe(false);
  });
});
