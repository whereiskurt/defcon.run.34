import { Ctf } from "@/entities/qr";
import { CtfSolve, CtfAttempt, CtfScoreEvent } from "@/entities/ctf";
import { RunUser } from "@/entities/run-user";
import {
  computePoints,
  activeTierCeiling,
  type ScoringConfig,
  type TimeTier,
} from "./ctf-scoring";
import { verifyAnswer, verifyAnswerHash } from "./ctf-hash";
import { isRepeatable, scoreBucket } from "./ctf-flag-types";
import { verifyTotp } from "./ctf-otp";
import { isWithinScoreWindow, type ScoreWindow } from "./ctf-score-window";
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

/**
 * A reward `effect` the judge carries OUT of a credited solve onto the NON-COVERT
 * claim response only (D-06 / CTFT-05). The judge does NOT interpret it — the shape
 * is authored per-challenge on `Ctf.effect` (typed `any` on the entity) and rendered
 * downstream (the `otp-enroll` renderer is Slice 1b). It is `unknown` on the result
 * so a caller must narrow before use.
 *
 * The ONE recognized/documented kind in Slice 1a is `otp-enroll`: it hands the
 * solver an `otpauth://` enrollment URL (the seed for a chained rotating-OTP flag)
 * plus an optional `nextFlag` name. It is a CARRIED PAYLOAD — the judge never reads
 * `otpauth`/`nextFlag`; the Slice-1b reveal UI does.
 *
 * ⚠️ INVARIANT (T-53-04-01): `effect` surfaces on `JudgeResult` for the visible,
 * authenticated non-covert solve ONLY. The covert CSS channel reads `solved` +
 * `points` and MUST NEVER carry a reward payload — see the covert-egg invariant tests.
 */
export interface OtpEnrollEffect {
  kind: "otp-enroll";
  /** The `otpauth://totp/...` enrollment URL (the chained OTP flag's seed). */
  otpauth: string;
  /** Optional NAME of the flag this enrollment unlocks (chaining hint for the UI). */
  nextFlag?: string;
}

export interface JudgeResult {
  solved: boolean;
  points: number;
  ordinal: number | null;
  firstBlood: boolean;
  capped: boolean;
  /**
   * The reward payload for a CREDITED (points > 0) solve, surfaced on the
   * non-covert claim response only. Absent/undefined on every NON_SOLVE, gate
   * failure, and non-award (capped ⇒ points 0) result — and on rows with no
   * `effect`. NEVER read by the covert path. See `OtpEnrollEffect`.
   */
  effect?: unknown;
}

/**
 * A Ctf row narrowed to a scoring-ready shape. 44-01 types the scoring fields as
 * optional (`number | undefined`), but `ScoringConfig` (44-02) requires them as
 * `number`. `CtfStore.getCtf` validates-on-load and coerces so `computePoints`
 * receives a well-typed config and `tsc` stays clean without `as any`.
 */
/**
 * The `otp` map the judge verifies against for `answerType === "otp"` (CTFT-02).
 * Mirrors the `Ctf.otp` entity map; every field optional (verifyTotp applies the
 * meshtk defaults: digits 6, period 120, SHA1, skew 1).
 */
export interface JudgeOtp {
  secret?: string;
  digits?: number;
  period?: number;
  algorithm?: string;
  skew?: number;
}

export interface JudgeCtf extends ScoringConfig {
  challenge: string;
  answerHash: string;
  enabled: boolean;
  maxAttempts?: number;
  rateLimitWindow?: number;
  // --- Flag-types framework (Slice 1a) — all optional; absent answerType == static.
  answerType?: "static" | "otp";
  otp?: JudgeOtp;
  /** Prerequisite challenge NAME (unlock/chaining gate). See D-02 (name, not id). */
  unlockAfter?: string;
  /** Min hours between a player's scoring solves (repeatable cadence). */
  perPlayerIntervalHours?: number;
  /** Max scoring solves per player (repeatable flags). */
  perPlayerMax?: number;
  /** Hard GLOBAL scoring cutoff across ALL players (0/absent = unlimited). */
  globalMax?: number;
  /**
   * Additive Slice-2 scoring-window gate input (CTFT-10). When set, the solve is
   * withheld unless `now` — evaluated in `scoreWindow.tz` (an IANA zone, so DST is
   * automatic via Intl) — falls inside the day/time window. ABSENT ⇒ always-open:
   * the gate is a complete no-op and every shipped flag is unchanged.
   */
  scoreWindow?: ScoreWindow;
  /**
   * The authored reward payload (D-06 / CTFT-05). Stored on `Ctf.effect` (`any`);
   * carried through untyped and returned VERBATIM on a credited solve — the judge
   * never interprets it. See `OtpEnrollEffect` for the recognized `otp-enroll` shape.
   */
  effect?: unknown;
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

  // --- Flag-types framework (Slice 1a) — OPTIONAL/ADDITIVE store ops. --------
  // These are only invoked for rows that use the new fields (unlockAfter set, or
  // isRepeatable). A static one-award flag never calls them, so a store built
  // for the shipped static path stays valid without implementing them.
  /**
   * Unlock prerequisite check: true iff the player has ANY score for `challenge`
   * (a CtfSolve OR a CtfScoreEvent row). A bounded existence read — never a scan.
   */
  hasScoreFor?(args: { challenge: string; user: string }): Promise<boolean>;
  /**
   * Atomic once-per-window claim: an attribute_not_exists conditional put on
   * CtfScoreEvent keyed (challenge, user, bucket). First writer in the window
   * wins (`claimed:true`); a same-window collision returns `claimed:false`
   * (already-scored-this-window). Any OTHER error rethrows so judgeSolve degrades
   * to a non-solve — mirrors `claimSolve`'s catch discipline. Runs BEFORE
   * allocateOrdinal so a losing double-submit never allocates.
   */
  claimScoreEvent?(args: {
    challenge: string;
    user: string;
    bucket: string;
    channel: Channel;
    scoredAt: string;
  }): Promise<{ claimed: boolean }>;
  /**
   * Per-player cap: true when the player is at/over `perPlayerMax` scoring solves
   * for this challenge. `false` when max is absent/0/non-finite (no cap). A
   * bounded per-(challenge,user) count via the byUser index — never a partition
   * scan.
   */
  overPerPlayerMax?(args: {
    challenge: string;
    user: string;
    max?: number;
  }): Promise<boolean>;
  /** Patch the freshly-claimed CtfScoreEvent row with its score/audit fields. */
  recordScoreEvent?(args: {
    challenge: string;
    user: string;
    bucket: string;
    points: number;
    tierCeiling: number;
    channel: Channel;
  }): Promise<void>;
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

    // (1b) UNLOCK / chaining gate (flag-types D-05 step 2). When `unlockAfter` is
    // set, the player must already hold a score for the prerequisite challenge
    // (by NAME — see D-02) or this solve is withheld. A locked gate is
    // INDISTINGUISHABLE from a wrong answer: it returns the same NON_SOLVE shape
    // and logs the same "no-solve" (never reveal the reason — SC-4 / T-53-03-02).
    // If the store cannot answer (method absent) we treat the gate as LOCKED so a
    // misconfigured store never leaks a free solve.
    if (ctf.unlockAfter) {
      const unlocked = store.hasScoreFor
        ? await store.hasScoreFor({ challenge: ctf.unlockAfter, user })
        : false;
      if (!unlocked) {
        log(ctfJudgeLog({ challenge, result: "no-solve" }));
        return NON_SOLVE;
      }
    }

    // (2) SCORING-WINDOW gate (Slice 2, CTFT-10). Ordered AFTER the unlock gate
    // (1b) and BEFORE the attempt-cap gate (3) — so a closed window short-circuits
    // BEFORE the state-mutating attempt-cap bump and before any answer validation.
    // When `scoreWindow` is set and `now` (epoch ms, evaluated in the flag's IANA
    // tz — DST automatic) is OUTSIDE the day/time window, this is INDISTINGUISHABLE
    // from a wrong answer: it returns the same NON_SOLVE and logs the same
    // "no-solve" the sibling gates emit (the guess/secret is NEVER passed to the
    // logger — the covert CSS channel invariant T-53-04-01 stays intact). ABSENT
    // `scoreWindow` ⇒ no-op (backward-compatible: every shipped flag unchanged).
    // isWithinScoreWindow is fail-closed on a bad tz, so a broken window denies.
    if (ctf.scoreWindow && !isWithinScoreWindow(ctf.scoreWindow, now)) {
      log(ctfJudgeLog({ challenge, result: "no-solve" }));
      return NON_SOLVE;
    }

    // (3) attempt-cap / rate-limit. Over-limit is INDISTINGUISHABLE from a wrong
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

    // (4) validate the answer BY answerType (flag-types D-05 step 5). NEVER log
    // `guess` OR `guessHash`. For `otp` the raw rolling code is verified against
    // the shared TOTP secret via verifyTotp (current period ± skew); verifyTotp
    // NEVER throws, so a wrong/undecodable code is an indistinguishable non-match
    // (there is no guessHash path for otp — it needs the raw code). For
    // `static`/absent, exactly one input is the validation source: a caller that
    // already holds only the hash (park-and-claim) passes `guessHash` and we
    // compare it directly; otherwise we hash the raw `guess`. Both static routes
    // converge on the same constant-time compare against `ctf.answerHash`.
    let ok: boolean;
    if (ctf.answerType === "otp") {
      const otp = ctf.otp ?? {};
      // judgeSolve's `now` is epoch MILLISECONDS; verifyTotp wants unix SECONDS.
      ok = verifyTotp(otp.secret ?? "", guess ?? "", Math.floor(now / 1000), {
        digits: otp.digits,
        period: otp.period,
        skew: otp.skew,
      });
    } else {
      ok =
        guessHash !== undefined
          ? verifyAnswerHash(guessHash, ctf.answerHash)
          : verifyAnswer(guess ?? "", ctf.answerHash);
    }
    if (!ok) {
      log(ctfJudgeLog({ challenge, result: "no-solve" }));
      return NON_SOLVE;
    }

    const scoredAt = new Date(now).toISOString();

    // (R) REPEATABLE path (flag-types D-04/D-05). A flag that is otp, or allows
    // >1 solve per player, or sets a per-player cadence writes the append-only
    // CtfScoreEvent ledger instead of the once-ever CtfSolve. The once-per-window
    // guarantee is an ATOMIC conditional put (bucket-in-sk), claimed BEFORE the
    // ordinal is allocated so a losing double-submit never allocates
    // (claim-before-allocate, mirroring the static CtfSolve invariant). Every
    // gate failure returns the SAME NON_SOLVE shape (indistinguishable).
    if (isRepeatable(ctf)) {
      const bucket = scoreBucket(now, {
        perPlayerIntervalHours: ctf.perPlayerIntervalHours,
        otpPeriodSeconds: ctf.otp?.period,
      });
      // (R1) atomic once-per-window claim — collision ⇒ already scored this
      // window ⇒ indistinguishable non-solve. Runs BEFORE allocateOrdinal.
      const claimed = store.claimScoreEvent
        ? await store.claimScoreEvent({ challenge, user, bucket, channel, scoredAt })
        : { claimed: false };
      if (!claimed.claimed) {
        log(ctfJudgeLog({ challenge, result: "no-solve" }));
        return NON_SOLVE;
      }
      // (R2) per-player cap — at/over perPlayerMax ⇒ indistinguishable non-solve.
      const overMax = store.overPerPlayerMax
        ? await store.overPerPlayerMax({ challenge, user, max: ctf.perPlayerMax })
        : false;
      if (overMax) {
        log(ctfJudgeLog({ challenge, result: "no-solve" }));
        return NON_SOLVE;
      }
      // (R3) allocate the GLOBAL ordinal atomically. globalMax is enforced off
      // this ordinal (n > globalMax ⇒ award 0 / no accrue) — NEVER a partition
      // query (T-53-03-03). A capped event is still solved:true/points:0, exactly
      // like the static maxSolves cap, so the covert channel (points>0 only) stays
      // dark for it.
      const n = await store.allocateOrdinal(challenge);
      if ((ctf.globalMax ?? 0) > 0 && n > (ctf.globalMax as number)) {
        log(ctfJudgeLog({ challenge, result: "capped" }));
        return { solved: true, points: 0, ordinal: n, firstBlood: false, capped: true };
      }
      // (R4) score + record the ledger row + accrue (exactly as CtfSolve accrues).
      const points = computePoints(n, ctf, now);
      const capped = points === 0;
      const firstBlood = n === 1;
      const tierCeiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax;
      if (store.recordScoreEvent) {
        await store.recordScoreEvent({ challenge, user, bucket, points, tierCeiling, channel });
      }
      await store.accrue({ user, points });
      log(ctfJudgeLog({ challenge, result: capped ? "capped" : "solve" }));
      // Carry the reward `effect` ONLY on a credited (points > 0) solve — a capped
      // (points 0) award is a non-award and stays effect-free (T-53-04-01 / SC-5).
      return { solved: true, points, ordinal: n, firstBlood, capped, effect: points > 0 ? ctf.effect : undefined };
    }

    // (5) claim — conditional put BEFORE ordinal allocation. A failed claim means
    // already-solved: celebrate the re-trigger but return the PRIOR award, never
    // re-score.  [STATIC one-award path — unchanged; only reached when NOT repeatable.]
    const solvedAt = scoredAt;
    const claim = await store.claimSolve({ challenge, user, channel, solvedAt });
    if (!claim.claimed) {
      const prior = claim.existing;
      const priorPoints = prior?.points ?? 0;
      log(ctfJudgeLog({ challenge, result: "replay" }));
      return {
        solved: true,
        points: priorPoints,
        ordinal: prior?.ordinal ?? null,
        firstBlood: prior?.firstBlood ?? false,
        capped: priorPoints === 0,
        // Re-surface the reward on an idempotent replay of a CREDITED award only.
        effect: priorPoints > 0 ? ctf.effect : undefined,
      };
    }

    // (6) allocate — atomic ADD solveCount 1. ONLY reached for genuinely-new
    // solvers (step 5 gates), so the counter is gap-free.
    const n = await store.allocateOrdinal(challenge);

    // (7) score, record, accrue.
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

    // (8) return. Carry the reward `effect` ONLY on a credited (points > 0) solve.
    log(ctfJudgeLog({ challenge, result: capped ? "capped" : "solve" }));
    return { solved: true, points, ordinal: n, firstBlood, capped, effect: points > 0 ? ctf.effect : undefined };
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
  answerType?: string;
  otp?: {
    secret?: string;
    digits?: number;
    period?: number;
    algorithm?: string;
    skew?: number;
  };
  unlockAfter?: string;
  perPlayerIntervalHours?: number;
  perPlayerMax?: number;
  globalMax?: number;
  scoreWindow?: { days?: number[]; from?: string; to?: string; tz?: string };
  effect?: unknown;
}): JudgeCtf {
  const timeTiers: TimeTier[] | undefined = Array.isArray(row.timeTiers)
    ? row.timeTiers.map((t) => ({
        from: t.from ?? "",
        to: t.to ?? "",
        ceiling: t.ceiling ?? 0,
      }))
    : undefined;
  // `answerType` narrows to the known union; anything unexpected (or absent)
  // reads as static — the backward-compatible default for every shipped row.
  const answerType: "static" | "otp" =
    row.answerType === "otp" ? "otp" : "static";
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
    // Flag-types fields (all default-safe; absent ⇒ static one-award behavior).
    answerType,
    otp: row.otp,
    unlockAfter: row.unlockAfter,
    perPlayerIntervalHours: row.perPlayerIntervalHours,
    perPlayerMax: row.perPlayerMax,
    globalMax: row.globalMax,
    // Slice-2 scoring window — carried verbatim so the judge's step-3 gate sees it
    // (mirrors `otp`/`unlockAfter`). Absent ⇒ omitted ⇒ always-open. The map's
    // fields are optional on the loaded row; coerce to the required ScoreWindow
    // shape (a malformed/empty tz fails-closed inside isWithinScoreWindow → deny).
    scoreWindow: row.scoreWindow
      ? {
          days: row.scoreWindow.days ?? [],
          from: row.scoreWindow.from ?? "",
          to: row.scoreWindow.to ?? "",
          tz: row.scoreWindow.tz ?? "",
        }
      : undefined,
    // The authored reward payload — passed through untyped (shape varies per
    // challenge); the judge returns it verbatim on a credited solve (D-06).
    effect: row.effect,
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

  // --- Flag-types framework (Slice 1a) — CtfScoreEvent ops. ------------------

  async hasScoreFor({ challenge, user }) {
    // Bounded existence read: a static solve OR any repeatable scoring event.
    // Short-circuits on the first hit; the byUser query is scoped to this
    // (user, challenge) via the gsi1 sk prefix — never a partition scan.
    const solve = await CtfSolve.get({ challenge, user }).go();
    if (solve.data) return true;
    const events = await CtfScoreEvent.query
      .byUser({ user, challenge })
      .go({ limit: 1 });
    return events.data.length > 0;
  },

  async claimScoreEvent({ challenge, user, bucket, channel, scoredAt }) {
    try {
      // ElectroDB create adds attribute_not_exists on the (user,bucket) sk →
      // the once-per-window conditional put. First writer in the window wins.
      await CtfScoreEvent.create({
        challenge,
        user,
        bucket,
        channel,
        scoredAt,
      }).go();
      return { claimed: true };
    } catch (err) {
      // A condition failure means the (user,bucket) row already exists (already
      // scored this window). If no row is present the failure was NOT a claim
      // collision — rethrow so judgeSolve degrades to a non-solve rather than
      // mis-report a win. Mirrors claimSolve's catch discipline.
      const existing = await CtfScoreEvent.get({ challenge, user, bucket }).go();
      if (!existing.data) throw err;
      return { claimed: false };
    }
  },

  async overPerPlayerMax({ challenge, user, max }) {
    if (!max || !Number.isFinite(max) || max <= 0) return false; // no cap
    // Bounded count of THIS player's scoring events for THIS challenge via the
    // byUser index (sk prefixed by challenge) — never a partition scan. The
    // just-claimed row is included, so an at-cap player reads count > max.
    const events = await CtfScoreEvent.query.byUser({ user, challenge }).go();
    return events.data.length > max;
  },

  async recordScoreEvent({
    challenge,
    user,
    bucket,
    points,
    tierCeiling,
    channel,
  }) {
    await CtfScoreEvent.patch({ challenge, user, bucket })
      .set({ points, tierCeiling, channel })
      .go();
  },
};
