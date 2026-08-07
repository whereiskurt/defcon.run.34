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

import { judgeBibPickup, judgeBibPrime, BIB_PICKUP_CHALLENGE } from "../bib-pickup";

const BIB = {
  runnerCode: "BIB-RXRN",
  nameOnBib: "KPHKPH2",
  hasSponsored: true,
  purchased: true,
};

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

  /**
   * A durable pass minted before the purchase gate existed must not pay out for
   * a bib nobody bought — 2 such passes were live when the gate landed.
   */
  it("does nothing for a bib row nobody bought, even with a live pass", async () => {
    loadBib.mockResolvedValue({ ...BIB, purchased: false });
    hasPass.mockResolvedValue(true);
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

/**
 * The operator side of the same workflow (2026-08-07).
 *
 * `ready` used to mean "has a Bib row and has never redeemed the 200", which by
 * the end of the con was true of 337 of the 353 bib rows — 274 of which were
 * never bought. Every operator scan therefore rendered "Bib ready" INSTEAD of
 * the ordinary connection card, so a scan that did award social points looked
 * like it had done nothing.
 *
 * `ready` now means exactly one thing: "this scan is about to prime a bought
 * bib that nobody has primed yet". Everything else is an ordinary social scan.
 */
describe("judgeBibPrime", () => {
  let primeLoadBib: any;
  let primeHasPass: any;
  let primeHasScoreFor: any;

  const prime = (userId = "owner-uuid") =>
    judgeBibPrime(userId, {
      loadBib: primeLoadBib,
      hasPass: primeHasPass,
      hasScoreFor: primeHasScoreFor,
    });

  beforeEach(() => {
    primeLoadBib = vi.fn().mockResolvedValue(BIB);
    primeHasPass = vi.fn().mockResolvedValue(false);
    primeHasScoreFor = vi.fn().mockResolvedValue(false);
  });

  it("is ready for a bought bib nobody has primed yet", async () => {
    expect(await prime()).toBe("ready");
  });

  it("is none for a runner with no bib row at all", async () => {
    primeLoadBib.mockResolvedValue(null);
    expect(await prime()).toBe("none");
    expect(primeHasPass).not.toHaveBeenCalled();
  });

  /**
   * 274 of 353 live Bib rows carry a runnerCode but were never paid for or
   * pledged. A placeholder row is not a bib anyone can collect.
   */
  it("is none for a bib row that was never bought", async () => {
    primeLoadBib.mockResolvedValue({ ...BIB, purchased: false });
    expect(await prime()).toBe("none");
    expect(primeHasPass).not.toHaveBeenCalled();
  });

  /**
   * THE NOISE CASE: an operator re-scanning someone they already primed. The
   * pass is durable, so there is nothing left to do — this is an ordinary
   * social scan and must render as one.
   */
  it("is none once a pass already exists — re-scanning primes nothing new", async () => {
    primeHasPass.mockResolvedValue(true);
    expect(await prime()).toBe("none");
  });

  it("is none for a runner who already collected", async () => {
    primeHasScoreFor.mockResolvedValue(true);
    expect(await prime()).toBe("none");
  });

  it("reads the pass and the ledger for the SCANNED runner", async () => {
    await prime("someone-else");
    expect(primeHasPass).toHaveBeenCalledWith("someone-else");
    expect(primeHasScoreFor).toHaveBeenCalledWith({
      challenge: BIB_PICKUP_CHALLENGE,
      user: "someone-else",
    });
  });
});
