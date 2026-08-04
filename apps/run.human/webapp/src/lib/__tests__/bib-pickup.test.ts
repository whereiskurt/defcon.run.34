import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bib pickup — the first self-scan.
 *
 * The load-bearing assertion here is "SHOWS EXACTLY ONCE". `judgeSolve` is
 * deliberately idempotent-ok: a replay loses the conditional claim and still
 * returns `solved: true` with the prior award. Relying on it for once-ever —
 * which is what the first draft of this feature did — yields a screen that
 * says "Bib Pickup!" on EVERY self-scan, which proves nothing about who owns
 * the bib. `judgeBibPickup` therefore checks first-ness explicitly, and the
 * second test below fails if anyone removes that check.
 */

vi.mock("@/entities/bib", () => ({ getBibForPickup: vi.fn() }));
vi.mock("@/entities/social", () => ({ BibPickupPass: { get: vi.fn() } }));
vi.mock("@/lib/ctf-judge", () => ({
  judgeSolve: vi.fn(),
  defaultStore: { hasScoreFor: vi.fn() },
}));

import { judgeBibPickup, BIB_PICKUP_CHALLENGE } from "../bib-pickup";

const BIB = { runnerCode: "BIB-RXRN", nameOnBib: "KPHKPH2", hasSponsored: true };

/* eslint-disable @typescript-eslint/no-explicit-any */
let loadBib: any;
let solve: any;
let hasScoreFor: any;
let hasPass: any;

const run = (userId = "me-uuid") =>
  judgeBibPickup(userId, { loadBib, solve, hasScoreFor, hasPass });

beforeEach(() => {
  loadBib = vi.fn().mockResolvedValue(BIB);
  solve = vi.fn().mockResolvedValue({ solved: true, points: 200 });
  hasScoreFor = vi.fn().mockResolvedValue(false);
  hasPass = vi.fn().mockResolvedValue(true);
});

describe("judgeBibPickup", () => {
  it("awards on the first self-scan and returns the bib to render", async () => {
    const result = await run();
    expect(result).toEqual({ points: 200, bib: BIB });
  });

  it("grants server-side — never validates a user-supplied answer", async () => {
    await run();
    expect(solve).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "me-uuid",
        challenge: BIB_PICKUP_CHALLENGE,
        grant: true,
      }),
      {}
    );
  });

  it("SHOWS ONCE: a later self-scan returns null even though judgeSolve would replay solved:true", async () => {
    hasScoreFor.mockResolvedValue(true);
    // Prove the trap is real: the judge WOULD say solved on a replay.
    solve.mockResolvedValue({ solved: true, points: 200 });

    expect(await run()).toBeNull();
    // And it must not even reach the judge — no re-award, no re-log.
    expect(solve).not.toHaveBeenCalled();
  });

  it("does nothing for a runner with no bib, and does NOT burn the award", async () => {
    loadBib.mockResolvedValue(null);
    expect(await run()).toBeNull();
    expect(solve).not.toHaveBeenCalled();
    expect(hasScoreFor).not.toHaveBeenCalled();
  });

  it("is INERT while the bib-pickup challenge is unseeded (judge non-solve)", async () => {
    solve.mockResolvedValue({ solved: false });
    expect(await run()).toBeNull();
  });

  it("degrades to null when the bib read throws — never takes the scan path down", async () => {
    loadBib.mockRejectedValue(new Error("dynamo is having a day"));
    await expect(run()).resolves.toBeNull();
  });

  it("degrades to null when the ledger read throws", async () => {
    hasScoreFor.mockRejectedValue(new Error("nope"));
    await expect(run()).resolves.toBeNull();
  });

  /**
   * The operator-primed pass (2026-08-04). Before this gate a runner could
   * award themselves 200 by scanning their own QR out of curiosity, which four
   * of them did. The award is meant to prove a volunteer handed over a bib, so
   * a self-scan alone must now be worth nothing.
   */
  it("THE GUARD: an unprimed self-scan awards NOTHING", async () => {
    hasPass.mockResolvedValue(false);
    expect(await run()).toBeNull();
    expect(solve).not.toHaveBeenCalled();
  });

  it("awards once an operator has primed the bib", async () => {
    hasPass.mockResolvedValue(true);
    expect(await run()).toEqual({ points: 200, bib: BIB });
  });

  it("first-ness still wins over a live pass — re-primed but already collected", async () => {
    hasScoreFor.mockResolvedValue(true);
    hasPass.mockResolvedValue(true);
    expect(await run()).toBeNull();
    expect(solve).not.toHaveBeenCalled();
  });

  it("degrades to null when the pass read throws", async () => {
    hasPass.mockRejectedValue(new Error("dynamo is having a day"));
    await expect(run()).resolves.toBeNull();
  });

  it("checks the pass for the CALLER", async () => {
    await run("someone-else");
    expect(hasPass).toHaveBeenCalledWith("someone-else");
  });

  it("checks first-ness for the CALLER, against the pickup challenge only", async () => {
    await run("someone-else");
    expect(hasScoreFor).toHaveBeenCalledWith({
      challenge: BIB_PICKUP_CHALLENGE,
      user: "someone-else",
    });
  });
});
