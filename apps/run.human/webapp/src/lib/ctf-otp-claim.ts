/**
 * ctf-otp-claim.ts — PURE claim/identity/TTL logic for the SINGLE-USE OTP flag
 * option (Phase 65, CTFT-16/17). The offline-testable twin of the judge's atomic
 * `CtfOtpClaim` conditional put.
 *
 * A `singleUse` rotating-OTP flag is FIRST-COME-FIRST-SERVED: the FIRST logged-in
 * player to redeem a given code wins globally; everyone else gets a NON_SOLVE. The
 * global arbiter is a DynamoDB create-if-absent conditional put on
 * `(challenge, codeHash)` (`CtfOtpClaim.create` — see `defaultStore.claimOtpCode`
 * in ctf-judge.ts). The functions here model that claim purely so the identity,
 * gate, and TTL math unit-test with NO ElectroDB/AWS chain, and so the judge test
 * fake can reuse `applyOtpClaim` as its backing store (one source of truth).
 *
 * ── WHY this file is import-pure ─────────────────────────────────────────────
 * It imports ONLY `hashAnswer` from ctf-hash (crypto-only, no AWS/ESM) as a VALUE,
 * and `CtfOtpClaimItem` as a TYPE. `import type` keeps the ElectroDB entity (and
 * its @auth/dynamodb-adapter ESM chain) OUT, so this module stays runtime-pure and
 * offline-testable — the same discipline as ctf-solve-merge.ts / ctf-seed-rows.ts.
 *
 * SECURITY: the raw rolling code is NEVER stored — only its salted `codeHash`
 * (via the same `hashAnswer` seam answers use). Never log the raw code/codeHash.
 */
import { hashAnswer } from "@/lib/ctf-hash";
import type { CtfOtpClaimItem } from "@/entities/ctf";

/** meshtk OTP defaults (mirror verifyTotp): period 120s, ± skew 1. */
const DEFAULT_OTP_PERIOD = 120;
const DEFAULT_OTP_SKEW = 1;

/**
 * PURE. The stable single-use code identity. The SAME physical 6-digit code hashes
 * identically regardless of who submits it or which skew offset matched, so one
 * physical code maps to exactly ONE claim key `(challenge, codeHash)`. Delegates to
 * the salted `hashAnswer` seam — the raw code is never recoverable/stored. The
 * judge computes the claim key through this exact function so its atomic
 * `CtfOtpClaim.create` and the pure gate model here agree on identity.
 */
export function otpCodeHash(rawGuess: string): string {
  return hashAnswer(rawGuess);
}

/**
 * PURE. The DynamoDB TTL (epoch SECONDS) for the consumed-code marker:
 * `floor(nowMs/1000) + period·(skew + 2)`. The marker auto-expires just past the
 * code's own validity window — by then `verifyTotp` rejects the code anyway, so a
 * re-use is a wrong-answer non-solve regardless of the marker's absence. No cleanup
 * job, no storage creep. Applies the meshtk defaults (period 120, skew 1) when a
 * field is unset/non-positive.
 */
export function otpClaimTtlSeconds(
  nowMs: number,
  otp?: { period?: number; skew?: number }
): number {
  const period = otp?.period && otp.period > 0 ? otp.period : DEFAULT_OTP_PERIOD;
  const skew = otp?.skew ?? DEFAULT_OTP_SKEW;
  return Math.floor(nowMs / 1000) + period * (skew + 2);
}

/**
 * PURE. The create-if-absent claim model — the offline twin of the ElectroDB
 * `CtfOtpClaim.create` conditional put (`attribute_not_exists` on the key). The
 * FIRST caller for a `codeHash` wins (`{ claimed: true }`) and records `claimedBy`;
 * a SECOND caller with the SAME `codeHash` LOSES (`{ claimed: false, claimedBy }`
 * carrying the winner) — there is NO lost update. A DIFFERENT `codeHash` is an
 * independent claim. The presence-check and set happen with no async gap, modeling
 * the atomicity DynamoDB's conditional put provides. The 65-02 judge test fake
 * backs its `claimOtpCode` onto this over a shared `Map`, so the race model and the
 * pure gate share one source of truth. (`claimedBy` mirrors
 * `CtfOtpClaimItem["claimedBy"]`.)
 */
export function applyOtpClaim(
  claims: Map<string, { claimedBy: string }>,
  codeHash: string,
  user: string
): { claimed: boolean; claimedBy?: string } {
  const existing = claims.get(codeHash);
  if (existing) return { claimed: false, claimedBy: existing.claimedBy };
  claims.set(codeHash, { claimedBy: user });
  return { claimed: true };
}

/**
 * PURE. The first-wins/second-loses gate decision the judge finalize applies: a won
 * claim credits the winner (`"credit"`); a lost/consumed claim is a NON_SOLVE
 * indistinguishable from a wrong answer (`"non-solve"`).
 */
export function resolveOtpClaimOutcome(result: {
  claimed: boolean;
}): "credit" | "non-solve" {
  return result.claimed ? "credit" : "non-solve";
}

// Keep the type import load-bearing for readers grepping the claim contract:
// `applyOtpClaim`'s returned `claimedBy` is the same value persisted as
// `CtfOtpClaimItem["claimedBy"]` (the winning authUserId).
export type { CtfOtpClaimItem };
