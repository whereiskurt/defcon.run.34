import { Ctf } from "@/entities/qr";
import { CtfSolve, CtfAttempt } from "@/entities/ctf";
import { RunUser } from "@/entities/run-user";
import {
  computePoints,
  activeTierCeiling,
  type ScoringConfig,
  type TimeTier,
} from "./ctf-scoring";
import { verifyAnswer, verifyAnswerHash } from "./ctf-hash";
import { ctfJudgeLog, emit } from "./ctf-log";

/**
 * CTF judge core (CTF-03) — the SINGLE function both future front doors call
 * (Phase 45 visible claim, Phase 46 covert CSS). It runs the LOCKED 7-step flow:
 *   load Ctf → attempt-cap → hashed-answer validate → conditional-put claim →
 *   atomic ordinal → score → accrue rollups.
 *
 * SERVER-ONLY: `defaultStore` imports the electro client (AWS creds from env), so
 * only import this from server components / route handlers — never a "use client"
 * module (mirrors lib/qr-admin.ts). The pure orchestration in `judgeSolve` is
 * fully testable via the injectable `CtfStore` seam with NO DynamoDB (see
 * __tests__/ctf-judge.test.ts).
 *
 * LOAD-BEARING correctness (proven by the concurrency/idempotency test):
 *   - claim (conditional-put CtfSolve, attribute_not_exists) happens BEFORE the
 *     atomic ordinal allocation, so the counter is gap-free and a losing
 *     double-submit never allocates an ordinal.
 *   - a failed claim (already solved) returns the PRIOR award, never re-scores.
 *   - the flow NEVER throws on a bad guess / missing / disabled challenge — it
 *     degrades to solved:false (mirrors the resolver's never-throw contract).
 *   - the raw guess is NEVER logged (ctfJudgeLog has no value parameter).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Channel = "qr" | "covert";

export interface JudgeResult {
  solved: boolean;
  points: number;
  ordinal: number | null;
  firstBlood: boolean;
  capped: boolean;
}

/**
 * A Ctf row narrowed to a scoring-ready shape. 44-01 types the scoring fields as
 * optional (`number | undefined`), but `ScoringConfig` (44-02) requires them as
 * `number`. `CtfStore.getCtf` validates-on-load and coerces so `computePoints`
 * receives a well-typed config and `tsc` stays clean without `as any`.
 */
export interface JudgeCtf extends ScoringConfig {
  challenge: string;
  answerHash: string;
  enabled: boolean;
  maxAttempts?: number;
  rateLimitWindow?: number;
}

/** The prior award returned when a claim loses the race (already solved). */
export interface PriorAward {
  ordinal: number;
  points: number;
  firstBlood: boolean;
}

/**
 * The data-layer seam the judge orchestrates. Each operation is independently
 * fakeable so the concurrency/idempotency proof runs against an in-memory store.
 */
export interface CtfStore {
  /** The scoring-ready Ctf row, or null if missing. */
  getCtf(challenge: string): Promise<JudgeCtf | null>;
  /** Read+increment the short-TTL attempt counter; over `max` in `window` → true. */
  overAttemptLimit(args: {
    challenge: string;
    user: string;
    window: number;
    max: number;
    now: number;
  }): Promise<boolean>;
  /**
   * Conditional put of the CtfSolve row (attribute_not_exists). First caller
   * wins (`claimed:true`); a condition failure means already-solved and returns
   * the prior award (`claimed:false, existing`).
   */
  claimSolve(args: {
    challenge: string;
    user: string;
    channel: Channel;
    solvedAt: string;
  }): Promise<{ claimed: boolean; existing?: PriorAward }>;
  /** Atomic ADD Ctf.solveCount 1 → the new ordinal. Gap-free (claim gates it). */
  allocateOrdinal(challenge: string): Promise<number>;
  /** Patch the freshly-claimed CtfSolve row with its score/ordinal/audit fields. */
  recordScore(args: {
    challenge: string;
    user: string;
    ordinal: number;
    points: number;
    firstBlood: boolean;
    tierCeiling: number;
    channel: Channel;
  }): Promise<void>;
  /** Atomic ADD RunUser.ctfScore points, ADD RunUser.ctfSolves 1. */
  accrue(args: { user: string; points: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// judgeSolve — the LOCKED 7-step flow
// ---------------------------------------------------------------------------

const NON_SOLVE: JudgeResult = {
  solved: false,
  points: 0,
  ordinal: null,
  firstBlood: false,
  capped: false,
};

/**
 * Judge a single solve attempt. Trusts the resolved `authUserId` (`user`) passed
 * by the front door — it never reads identity from the guess. Injectable `store`,
 * `now`, and `log` via `deps` (defaults: `defaultStore`, `Date.now()`, `emit`).
 */
export async function judgeSolve(
  input: {
    user: string;
    challenge: string;
    guess?: string;
    guessHash?: string;
    channel: Channel;
  },
  deps: { store?: CtfStore; now?: number; log?: (o: unknown) => void } = {},
): Promise<JudgeResult> {
  const store = deps.store ?? defaultStore;
  const now = deps.now ?? Date.now();
  const log = deps.log ?? emit;
  const { user, challenge, guess, guessHash, channel } = input;

  try {
    // (1) load Ctf; missing or disabled → non-solve (covert renders it as decoy).
    const ctf = await store.getCtf(challenge);
    if (!ctf || !ctf.enabled) {
      log(ctfJudgeLog({ challenge, result: "no-solve" }));
      return NON_SOLVE;
    }

    // (2) attempt-cap / rate-limit. Over-limit is INDISTINGUISHABLE from a wrong
    // guess (covert invisibility — do NOT reveal the reason).
    const over = await store.overAttemptLimit({
      challenge,
      user,
      window: ctf.rateLimitWindow ?? 0,
      max: ctf.maxAttempts ?? Number.POSITIVE_INFINITY,
      now,
    });
    if (over) {
      log(ctfJudgeLog({ challenge, result: "no-solve" }));
      return NON_SOLVE;
    }

    // (3) validate the answer. NEVER log `guess` OR `guessHash`. Exactly one
    // input is the validation source: a caller that already holds only the hash
    // (the park-and-claim path) passes `guessHash` and we compare it directly;
    // otherwise we hash the raw `guess`. Both routes converge on the same
    // constant-time compare against `ctf.answerHash`.
    const ok =
      guessHash !== undefined
        ? verifyAnswerHash(guessHash, ctf.answerHash)
        : verifyAnswer(guess ?? "", ctf.answerHash);
    if (!ok) {
      log(ctfJudgeLog({ challenge, result: "no-solve" }));
      return NON_SOLVE;
    }

    // (4) claim — conditional put BEFORE ordinal allocation. A failed claim means
    // already-solved: celebrate the re-trigger but return the PRIOR award, never
    // re-score.
    const solvedAt = new Date(now).toISOString();
    const claim = await store.claimSolve({ challenge, user, channel, solvedAt });
    if (!claim.claimed) {
      const prior = claim.existing;
      log(ctfJudgeLog({ challenge, result: "replay" }));
      return {
        solved: true,
        points: prior?.points ?? 0,
        ordinal: prior?.ordinal ?? null,
        firstBlood: prior?.firstBlood ?? false,
        capped: (prior?.points ?? 0) === 0,
      };
    }

    // (5) allocate — atomic ADD solveCount 1. ONLY reached for genuinely-new
    // solvers (step 4 gates), so the counter is gap-free.
    const n = await store.allocateOrdinal(challenge);

    // (6) score, record, accrue.
    const points = computePoints(n, ctf, now);
    const capped = points === 0; // n > maxSolves
    const firstBlood = n === 1;
    const tierCeiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax;
    await store.recordScore({
      challenge,
      user,
      ordinal: n,
      points,
      firstBlood,
      tierCeiling,
      channel,
    });
    await store.accrue({ user, points });

    // (7) return.
    log(ctfJudgeLog({ challenge, result: capped ? "capped" : "solve" }));
    return { solved: true, points, ordinal: n, firstBlood, capped };
  } catch {
    // Never throw: any store/validation error degrades to a non-solve. Guard the
    // log too so a broken logger can't escape the contract.
    try {
      log(ctfJudgeLog({ challenge, result: "no-solve" }));
    } catch {
      /* swallow — the never-throw contract wins over observability */
    }
    return NON_SOLVE;
  }
}

// ---------------------------------------------------------------------------
// defaultStore — electro-backed CtfStore on the 44-01 entities
// ---------------------------------------------------------------------------

/** Narrow a loaded Ctf row (optional scoring fields) to the scoring-ready shape. */
function narrowCtf(row: {
  challenge: string;
  answerHash?: string;
  enabled?: boolean;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  timeTiers?: Array<{ from?: string; to?: string; ceiling?: number }>;
  maxAttempts?: number;
  rateLimitWindow?: number;
}): JudgeCtf {
  const timeTiers: TimeTier[] | undefined = Array.isArray(row.timeTiers)
    ? row.timeTiers.map((t) => ({
        from: t.from ?? "",
        to: t.to ?? "",
        ceiling: t.ceiling ?? 0,
      }))
    : undefined;
  return {
    challenge: row.challenge,
    answerHash: row.answerHash ?? "",
    enabled: row.enabled ?? false,
    pointMax: row.pointMax ?? 0,
    pointFloor: row.pointFloor ?? 0,
    maxSolves: row.maxSolves ?? 0,
    firstBloodBonus: row.firstBloodBonus ?? 0,
    timeTiers,
    maxAttempts: row.maxAttempts,
    rateLimitWindow: row.rateLimitWindow,
  };
}

export const defaultStore: CtfStore = {
  async getCtf(challenge) {
    const res = await Ctf.get({ challenge }).go();
    return res.data ? narrowCtf(res.data) : null;
  },

  async overAttemptLimit({ challenge, user, window, max, now }) {
    if (!Number.isFinite(max)) return false; // no cap configured → never over
    // Atomic increment of the short-TTL per-(challenge,user) counter. TTL is set
    // on write so DynamoDB reaps stale windows; a fresh window starts at 1.
    const ttl = Math.floor(now / 1000) + (window || 0);
    const res = await CtfAttempt.upsert({ challenge, user })
      .add({ count: 1 })
      .set({ ttl, expiresAt: ttl })
      .go({ response: "all_new" });
    const count = (res.data as { count?: number }).count ?? 0;
    return count > max;
  },

  async claimSolve({ challenge, user, channel, solvedAt }) {
    try {
      // ElectroDB create adds attribute_not_exists on the key → conditional put.
      await CtfSolve.create({ challenge, user, channel, solvedAt }).go();
      return { claimed: true };
    } catch (err) {
      // A condition failure means the row already exists (already solved). Read
      // the prior award. If no row is present the failure was NOT a claim race —
      // rethrow so judgeSolve degrades to a non-solve rather than mis-report a win.
      const existing = await CtfSolve.get({ challenge, user }).go();
      if (!existing.data) throw err;
      return {
        claimed: false,
        existing: {
          ordinal: existing.data.ordinal ?? 0,
          points: existing.data.points ?? 0,
          firstBlood: existing.data.firstBlood ?? false,
        },
      };
    }
  },

  async allocateOrdinal(challenge) {
    const res = await Ctf.patch({ challenge })
      .add({ solveCount: 1 })
      .go({ response: "all_new" });
    return (res.data as { solveCount?: number }).solveCount ?? 0;
  },

  async recordScore({
    challenge,
    user,
    ordinal,
    points,
    firstBlood,
    tierCeiling,
    channel,
  }) {
    await CtfSolve.patch({ challenge, user })
      .set({ ordinal, points, firstBlood, tierCeiling, channel })
      .go();
  },

  async accrue({ user, points }) {
    await RunUser.patch({ userId: user })
      .add({ ctfScore: points, ctfSolves: 1 })
      .go();
  },
};
