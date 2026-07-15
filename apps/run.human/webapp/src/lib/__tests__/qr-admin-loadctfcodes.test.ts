import { describe, it, expect, vi, beforeEach } from "vitest";

// WR-01 regression: loadCtfCodes must (a) count `added` from ACTUAL successful
// CtfCode.create() calls — not the pre-loop hashCodeBatch value — and (b)
// distinguish a create-collision (codeHash already in the pool ⇒ duplicate,
// add-only no-op) from a genuine transient error (⇒ rethrow, so the admin never
// believes a code loaded when it did not). Classification mirrors
// claimSolve/claimCode in ctf-judge.ts: re-read the row after a failed create —
// present ⇒ collision, absent ⇒ rethrow.
//
// Seam: mock ONLY the electro CtfCode entity so the pure hashing + the loop's
// success/collision/rethrow logic run for real against an in-memory fake DB.

const createGo = vi.fn();
const getGo = vi.fn();

vi.mock("@/entities/ctf", () => ({
  CtfSolve: {},
  CtfScoreEvent: {},
  CtfCode: {
    create: vi.fn(() => ({ go: createGo })),
    get: vi.fn(() => ({ go: getGo })),
  },
}));

import { loadCtfCodes } from "../qr-admin";

// A stand-in for the ElectroDB ConditionalCheckFailed a create raises when the
// codeHash key already exists. loadCtfCodes does NOT branch on the error shape
// (it re-reads the row like claimSolve), so any Error works — what matters is
// what the follow-up CtfCode.get returns.
class ConditionalCheckFailed extends Error {
  constructor() {
    super("The conditional request failed");
    this.name = "ConditionalCheckFailedException";
  }
}

describe("loadCtfCodes — WR-01 accurate added/duplicates + transient rethrow", () => {
  beforeEach(() => {
    createGo.mockReset();
    getGo.mockReset();
  });

  it("counts one new code and one already-in-pool code as {added:1, duplicates:1}", async () => {
    // First create succeeds (new code), second collides on the existence
    // condition (already in the pool).
    createGo
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new ConditionalCheckFailed());
    // The collision re-read finds the row present ⇒ genuine duplicate.
    getGo.mockResolvedValue({ data: { challenge: "wl", codeHash: "x" } });

    const out = await loadCtfCodes("wl", ["new-code", "already-in-pool"]);

    expect(out).toEqual({ added: 1, duplicates: 1 });
  });

  it("rethrows a transient (non-conditional) create error instead of reporting a false success", async () => {
    // create fails, and the re-read finds NO row ⇒ the failure was NOT a
    // collision (throttle / network) ⇒ surface it.
    createGo.mockRejectedValueOnce(new Error("ProvisionedThroughputExceededException"));
    getGo.mockResolvedValue({ data: undefined });

    await expect(loadCtfCodes("wl", ["some-code"])).rejects.toThrow(
      "ProvisionedThroughputExceededException"
    );
  });

  it("folds within-batch duplicates into the returned duplicates count", async () => {
    // Two identical lines hash to one distinct codeHash ⇒ hashCodeBatch yields
    // 1 codeHash + 1 in-batch duplicate. The single create succeeds.
    createGo.mockResolvedValueOnce({ data: {} });

    const out = await loadCtfCodes("wl", ["dup", "dup"]);

    expect(out).toEqual({ added: 1, duplicates: 1 });
    expect(createGo).toHaveBeenCalledTimes(1);
  });
});
