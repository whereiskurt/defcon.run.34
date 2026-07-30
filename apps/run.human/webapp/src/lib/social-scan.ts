import { socialDay } from "./social-day";
import { TOKEN_RE } from "./short-token";
import { pairKey, applyScoreDelta } from "./social-rank";
import { RunnerToken } from "@/entities/runner-token";
import { RunUser, getUserByHash } from "@/entities/run-user";
import { SocialPair, SocialQuota } from "@/entities/social";
import { CtfScoreEvent } from "@/entities/ctf";

/**
 * Social-scan judge (runner social QR).
 *
 * Mutual award: scanning another runner's QR credits BOTH parties +1
 * socialScore, once per unordered pair per PT day, scanner capped at
 * DAILY_SCAN_CAP successful scans/day. socialScore is a cosmetic meter
 * (drives the whoami QR rank bands) — it awards ZERO score points. The
 * scan-day ledger rows exist only to light social streak days; they are
 * valued (or not) by lib/scoring-engine, never by this module. The
 * DC-jack egg is routed through lib/ctf-judge (see app/api/social-egg) so
 * its points, if any, come from the judge's derived scoring, not a
 * hardcoded constant here.
 *
 * Store seam mirrors lib/ctf-judge.ts: pure judge over an injectable
 * ScanStore; defaultScanStore is the ElectroDB implementation. The
 * pair-day conditional create is the idempotency gate — award failures
 * after the gate log loudly but do not roll back (scores are additive,
 * CtfScoreEvent rows are the audit trail).
 */

export const DAILY_SCAN_CAP = 50;

const HASH_RE = /^[0-9a-f]{64}$/;

export type SocialUser = {
  userId: string;
  displayName?: string;
  socialScore?: number;
};

export type ScanStore = {
  resolveOwnerByToken(token: string): Promise<SocialUser | null>;
  resolveOwnerByHash(hash: string): Promise<SocialUser | null>;
  getUser(userId: string): Promise<SocialUser | null>;
  /** Conditional create of the pair-day row; false ⇒ already claimed. */
  claimPairDay(
    pk: string,
    day: string,
    scannerId: string,
    ownerId: string
  ): Promise<boolean>;
  /** ADD 1 to the scanner's day counter; returns the NEW count. */
  bumpQuota(userId: string, day: string): Promise<number>;
  /** RunUser.patch add socialScore — the cosmetic meter only. */
  award(userId: string, social: number): Promise<void>;
  /** CtfScoreEvent ledger row; duplicates swallowed. */
  ledger(
    challenge: string,
    user: string,
    bucket: string,
    points: number
  ): Promise<void>;
  /** SocialBoard distribution move old→new. */
  scoreDelta(oldScore: number, newScore: number): Promise<void>;
};

export type ScanResult =
  | { ok: true; ownerId: string; ownerName: string; remainingToday: number }
  | {
      ok: false;
      code: "bad_token" | "not_found" | "self" | "already_today" | "cap";
    };

export async function judgeScan(
  input: {
    scannerId: string;
    token?: string;
    hash?: string;
    nowMs: number;
    /** Admin attendance mode: usage is still counted, the cap is not enforced. */
    capExempt?: boolean;
  },
  store: ScanStore
): Promise<ScanResult> {
  const { scannerId, nowMs } = input;
  const token = input.token?.trim().toLowerCase();
  const hash = input.hash?.trim().toLowerCase();

  let owner: SocialUser | null = null;
  if (token) {
    if (!TOKEN_RE.test(token)) return { ok: false, code: "bad_token" };
    owner = await store.resolveOwnerByToken(token);
  } else if (hash) {
    if (!HASH_RE.test(hash)) return { ok: false, code: "bad_token" };
    owner = await store.resolveOwnerByHash(hash);
  } else {
    return { ok: false, code: "bad_token" };
  }

  if (!owner) return { ok: false, code: "not_found" };
  if (owner.userId === scannerId) return { ok: false, code: "self" };

  const day = socialDay(nowMs);
  const pk = pairKey(scannerId, owner.userId);
  const claimed = await store.claimPairDay(pk, day, scannerId, owner.userId);
  if (!claimed) return { ok: false, code: "already_today" };

  // Cap check AFTER the pair claim: an over-cap scan burns the pair for the
  // day (prevents cap-probing the same target repeatedly). Only the scanner
  // is charged quota. capExempt scanners (admin attendance mode) keep the
  // usage counter honest but skip enforcement.
  const count = await store.bumpQuota(scannerId, day);
  if (!input.capExempt && count > DAILY_SCAN_CAP) {
    return { ok: false, code: "cap" };
  }

  const bucket = `${day}#${pk}`;
  try {
    const scanner = await store.getUser(scannerId);
    await Promise.all([
      store.award(scannerId, 1),
      store.award(owner.userId, 1),
      store.ledger("social-scan", scannerId, bucket, 0),
      store.ledger("social-scan", owner.userId, bucket, 0),
    ]);
    const scannerOld = scanner?.socialScore ?? 0;
    const ownerOld = owner.socialScore ?? 0;
    await Promise.all([
      store.scoreDelta(scannerOld, scannerOld + 1),
      store.scoreDelta(ownerOld, ownerOld + 1),
    ]);
  } catch (err) {
    console.error("[social-scan] partial award failure (pair claimed)", err);
  }

  return {
    ok: true,
    ownerId: owner.userId,
    ownerName: owner.displayName || "a runner",
    remainingToday: Math.max(0, DAILY_SCAN_CAP - count),
  };
}

// ---------------------------------------------------------------------------
// ElectroDB store
// ---------------------------------------------------------------------------

async function loadRunUser(userId: string): Promise<SocialUser | null> {
  const result = await RunUser.get({ userId }).go();
  if (!result.data) return null;
  return {
    userId: result.data.userId,
    displayName: result.data.displayName,
    socialScore: result.data.socialScore ?? 0,
  };
}

export const defaultScanStore: ScanStore = {
  async resolveOwnerByToken(token) {
    const row = await RunnerToken.get({ token }).go();
    if (!row.data) return null;
    return loadRunUser(row.data.userId);
  },
  async resolveOwnerByHash(hash) {
    const user = await getUserByHash(hash);
    if (!user) return null;
    return {
      userId: user.userId,
      displayName: user.displayName,
      socialScore: user.socialScore ?? 0,
    };
  },
  getUser: loadRunUser,
  async claimPairDay(pk, day, scannerId, ownerId) {
    try {
      await SocialPair.create({ pairKey: pk, day, scannerId, ownerId }).go();
      return true;
    } catch {
      return false;
    }
  },
  async bumpQuota(userId, day) {
    const result = await SocialQuota.update({ userId, day })
      .add({ count: 1 })
      .go({ response: "all_new" });
    return result.data?.count ?? DAILY_SCAN_CAP + 1;
  },
  async award(userId, social) {
    await RunUser.patch({ userId }).add({ socialScore: social }).go();
  },
  async ledger(challenge, user, bucket, points) {
    try {
      await CtfScoreEvent.create({
        challenge,
        user,
        bucket,
        points,
        channel: "qr",
        scoredAt: new Date().toISOString(),
      }).go();
    } catch {
      // duplicate ledger row — already recorded
    }
  },
  scoreDelta: applyScoreDelta,
};
