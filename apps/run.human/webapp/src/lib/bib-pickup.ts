import { getBibForPickup, type BibForPickup } from "@/entities/bib";
import { BibPickupPass } from "@/entities/social";
import { judgeSolve, defaultStore } from "@/lib/ctf-judge";

/**
 * Bib pickup — the first self-scan, AFTER an operator has primed the bib.
 *
 * Two scans by two people:
 *   1. PRIME — an operator (QR_ADMIN_GROUPS) scans the runner's bib QR. That is
 *      an ordinary social scan that additionally mints a durable BibPickupPass
 *      (see lib/social-scan.ts). Bibs are primed in bulk the day before the con.
 *   2. REDEEM — the runner scans their OWN QR. The pass is what unlocks the bib
 *      screen and the award.
 *
 * The pass gate was added 2026-08-04. Originally the first self-scan alone paid
 * out, on the theory that a volunteer had just shown the runner their bib — but
 * nothing actually required the volunteer, and four runners awarded themselves
 * 200 by scanning their own QR out of curiosity. A self-scan on its own is now
 * worth nothing.
 *
 * ── Why the CTF ledger pays the award ───────────────────────────────────────
 * The derived score is `runStreak + socialStreak + ctfStreak + flagPoints`, and
 * accomplishments carry NO points — they only light con-days. `flagPoints` is
 * therefore the only mechanism that pays a discrete, once-ever award, which is
 * the same path the jack-egg uses.
 *
 * ⚠️ BUT the ledger alone does NOT give us "show it once". `judgeSolve` is
 * deliberately IDEMPOTENT-OK: a replay loses the conditional claim and returns
 * `solved: TRUE` with the PRIOR award (ctf-judge.ts — "a failed claim returns
 * the prior award, never re-scores"). That is right for the jack-egg, whose
 * route wants a replay to look identical to a first claim. It is exactly WRONG
 * here: a screen that says "Bib Pickup!" every single time proves nothing, and
 * proving the bib is theirs is the entire point of the workflow.
 *
 * So first-ness is checked EXPLICITLY, before granting, via the store's bounded
 * `hasScoreFor` existence read. Already scored → null → the caller shows the
 * ordinary "that's your own QR code".
 *
 * Race note: two truly simultaneous self-scans could both pass the pre-check
 * and both render the screen. Harmless — the conditional put still means only
 * one claim is real, so the award cannot be doubled, and a double-tap at the
 * pickup table is not a spoofing vector. What matters is that a scan MINUTES
 * later never shows the screen, and the pre-check guarantees that.
 *
 * `grant: true` skips answer validation — entitlement was proven out of band by
 * the scan resolving to the caller's own hash, which no user input can forge.
 * Every other gate (enabled, windows, claims) still applies.
 *
 * ── Fails INERT, never broken ───────────────────────────────────────────────
 * Returns null — caller shows the ordinary "that's your own QR code" — when:
 *   - the runner has no bib (nothing to pick up),
 *   - the `bib-pickup` Ctf row is unseeded or disabled (judgeSolve non-solve),
 *   - they already picked up (the explicit first-ness check above),
 *   - NO operator has primed their bib (the pass gate),
 *   - the bib read, the ledger read, or the pass read throws.
 * A missing seed row therefore means the feature is dormant, NOT that scanning
 * breaks. Seeding is still part of shipping: until the row exists, nobody can
 * ever see the screen.
 */

/** Challenge slug for the grant-only pickup award. Must match the seeded row. */
export const BIB_PICKUP_CHALLENGE = "bib-pickup";

/** Existence read for a runner's pickup pass. Shared by both sides of the flow. */
export async function hasPickupPass(userId: string): Promise<boolean> {
  return Boolean((await BibPickupPass.get({ userId }).go()).data);
}

/**
 * Operator-scan verdict — the PRIME side of the flow.
 *   none  → an ordinary social scan; say nothing about bibs
 *   ready → this scan is about to prime a bought bib nobody has primed yet
 *
 * `ready` is deliberately narrow, and was not always. Until 2026-08-07 it meant
 * "has a Bib row and has never redeemed the 200", which was true of 337 of the
 * 353 live bib rows — 274 of them placeholders nobody ever bought. Since the
 * clients render the bib card INSTEAD of the connection card, that made "Bib
 * ready" the answer to nearly every operator scan and hid the social award that
 * had just happened. The verdict now flips to `none` the moment there is
 * nothing left to prime, so the noise stops after the one scan that matters.
 *
 * Gate order is cheapest-and-most-selective first: no bib → not bought → already
 * primed → already collected. The pass read short-circuits the ledger read,
 * which is the common case for anyone primed at the table.
 *
 * Throws on a read failure. `judgeScan` catches — priming is additive and must
 * never take a scan down with it.
 */
export type BibScanStatus = "none" | "ready";

export async function judgeBibPrime(
  userId: string,
  deps: {
    loadBib?: typeof getBibForPickup;
    hasPass?: (userId: string) => Promise<boolean>;
    hasScoreFor?: (a: { challenge: string; user: string }) => Promise<boolean>;
  } = {}
): Promise<BibScanStatus> {
  const loadBib = deps.loadBib ?? getBibForPickup;
  const hasPass = deps.hasPass ?? hasPickupPass;
  const hasScoreFor = deps.hasScoreFor ?? ((a) => defaultStore.hasScoreFor!(a));

  const bib = await loadBib(userId);
  // A runnerCode alone is not a bib — every row gets one at create time. Only a
  // purchase means a volunteer has something to hand over.
  if (!bib?.purchased) return "none";
  // Already primed. The pass is durable, so a re-scan primes nothing new and
  // this is just an ordinary connection.
  if (await hasPass(userId)) return "none";
  // Same existence read judgeBibPickup uses for first-ness, so the operator's
  // verdict and the runner's award can never disagree.
  if (await hasScoreFor({ challenge: BIB_PICKUP_CHALLENGE, user: userId })) {
    return "none";
  }
  return "ready";
}

export type BibPickupAward = {
  points: number;
  bib: BibForPickup;
};

/**
 * Award the bib pickup for `userId`, or null if this is not a first pickup.
 * Never throws — a lookup failure degrades to "no pickup", because a broken
 * bib read must not take the scan path down with it.
 */
export async function judgeBibPickup(
  userId: string,
  deps: {
    loadBib?: typeof getBibForPickup;
    solve?: typeof judgeSolve;
    hasScoreFor?: (a: { challenge: string; user: string }) => Promise<boolean>;
    hasPass?: (userId: string) => Promise<boolean>;
  } = {}
): Promise<BibPickupAward | null> {
  const loadBib = deps.loadBib ?? getBibForPickup;
  const solve = deps.solve ?? judgeSolve;
  const hasScoreFor =
    deps.hasScoreFor ??
    ((a) => defaultStore.hasScoreFor!(a));
  const hasPass = deps.hasPass ?? hasPickupPass;

  try {
    const bib = await loadBib(userId);
    // No bib = nothing to hand over. Do NOT burn the once-ever award on a
    // runner who has nothing to pick up — they may get a bib later.
    if (!bib) return null;
    // A placeholder row is not a bib either (see BibForPickup.purchased). Read
    // here as well as on the prime side because passes minted BEFORE the
    // purchase gate existed are durable: 2 of the 62 live passes on 2026-08-07
    // were for rows nobody ever bought, and this is what stops them paying out.
    if (!bib.purchased) return null;

    // FIRST time only. judgeSolve would happily answer solved:true on a replay
    // (see the header) — this is what actually makes the screen mean something.
    if (await hasScoreFor({ challenge: BIB_PICKUP_CHALLENGE, user: userId })) {
      return null;
    }

    // THE GUARD: an operator must have primed this bib first (they scanned the
    // runner's QR at the table, minting a BibPickupPass). Without it a runner
    // awards themselves 200 by scanning their own QR — which four of them did
    // before this existed. Ordered AFTER first-ness so someone who already
    // collected gets the ordinary message whether or not they were re-primed.
    if (!(await hasPass(userId))) return null;

    const result = await solve(
      {
        user: userId,
        challenge: BIB_PICKUP_CHALLENGE,
        channel: "qr",
        grant: true,
      },
      {}
    );
    if (!result.solved) return null;

    return { points: result.points ?? 0, bib };
  } catch {
    return null;
  }
}
