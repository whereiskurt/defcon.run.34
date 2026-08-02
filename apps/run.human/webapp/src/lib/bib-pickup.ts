import { getBibForPickup, type BibForPickup } from "@/entities/bib";
import { judgeSolve, defaultStore } from "@/lib/ctf-judge";

/**
 * Bib pickup — the first self-scan.
 *
 * At the pickup table a runner says their bib, a volunteer shows it to them,
 * and then the runner scans it. If the scan resolves to their OWN QR and this
 * is the first time, the bib is theirs: render it and award the pickup.
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
 *   - the bib read or the ledger read throws.
 * A missing seed row therefore means the feature is dormant, NOT that scanning
 * breaks. Seeding is still part of shipping: until the row exists, nobody can
 * ever see the screen.
 */

/** Challenge slug for the grant-only pickup award. Must match the seeded row. */
export const BIB_PICKUP_CHALLENGE = "bib-pickup";

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
  } = {}
): Promise<BibPickupAward | null> {
  const loadBib = deps.loadBib ?? getBibForPickup;
  const solve = deps.solve ?? judgeSolve;
  const hasScoreFor =
    deps.hasScoreFor ??
    ((a) => defaultStore.hasScoreFor!(a));

  try {
    const bib = await loadBib(userId);
    // No bib = nothing to hand over. Do NOT burn the once-ever award on a
    // runner who has nothing to pick up — they may get a bib later.
    if (!bib) return null;

    // FIRST time only. judgeSolve would happily answer solved:true on a replay
    // (see the header) — this is what actually makes the screen mean something.
    if (await hasScoreFor({ challenge: BIB_PICKUP_CHALLENGE, user: userId })) {
      return null;
    }

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
