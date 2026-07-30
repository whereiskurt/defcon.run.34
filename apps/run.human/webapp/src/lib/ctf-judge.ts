import { Ctf } from "@/entities/qr";
import { CtfSolve, CtfAttempt, CtfScoreEvent, CtfCode, CtfOtpClaim } from "@/entities/ctf";
import { RunUser } from "@/entities/run-user";
import {
  computePoints,
  activeTierCeiling,
  type ScoringConfig,
  type TimeTier,
} from "./ctf-scoring";
import { verifyAnswer, verifyAnswerHash, hashAnswer } from "./ctf-hash";
import { isRepeatable, scoreBucket } from "./ctf-flag-types";
import { verifyTotp } from "./ctf-otp";
import { otpCodeHash, otpClaimTtlSeconds } from "./ctf-otp-claim";
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
  /**
   * First-come single-use (Phase 65, CTFT-17). When true, a given rolling code is
   * consumed globally by the FIRST logged-in redeemer (the judge's single-use OTP
   * finalize) — everyone else gets an indistinguishable NON_SOLVE. Absent/false ⇒
   * the SHARED repeatable path (every valid code scores per player), UNCHANGED.
   */
  singleUse?: boolean;
}

export interface JudgeCtf extends ScoringConfig {
  challenge: string;
  answerHash: string;
  enabled: boolean;
  maxAttempts?: number;
  rateLimitWindow?: number;
  // --- Flag-types framework (Slice 1a/3) — all optional; absent answerType == static.
  answerType?: "static" | "otp" | "wordlist";
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
  /**
   * Adjust RunUser.ctfScore by a (possibly negative) delta WITHOUT touching
   * ctfSolves — used by the admin re-score override to keep the board idempotent
   * (a re-submit reflects the current config as a single award, never additive).
   * A zero delta is a no-op. (main #619 admin re-submit override.)
   */
  reaccrue(args: { user: string; delta: number }): Promise<void>;

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
    ordinal: number;
    points: number;
    tierCeiling: number;
    channel: Channel;
  }): Promise<void>;

  // --- Wordlist single-use codes (flag-types Slice 3, CTFT-13) — OPTIONAL. -----
  /**
   * The ATOMIC single-use claim for a `wordlist` code (CTFT-13). A conditional
   * patch on the `CtfCode` row keyed (challenge, codeHash) that sets
   * `claimedBy`/`claimedAt` IFF the row EXISTS and `claimedBy` is still UNSET
   * (`attribute_not_exists(claimedBy)`). The FIRST concurrent claimer of a code
   * wins (`claimed:true`); a USED code, an UNKNOWN code (no row), or an ABSENT op
   * all read as `claimed:false` — the indistinguishable non-solve. This single
   * conditional update IS both the wordlist answer validation AND the single-use
   * idempotency guard, so the wordlist path never touches `claimScoreEvent`.
   *
   * Catch discipline mirrors `claimScoreEvent`: a claim collision / missing-row
   * failure ⇒ `{claimed:false}`; any OTHER error rethrows so `judgeSolve` degrades
   * to a non-solve rather than mis-report a win. NEVER log the codeHash or guess.
   * Kept OPTIONAL so a store built only for the static/otp path stays type-clean.
   */
  claimCode?(args: {
    challenge: string;
    codeHash: string;
    user: string;
    claimedAt: string;
  }): Promise<{ claimed: boolean }>;

  // --- Single-use OTP claim (Phase 65, CTFT-17) — OPTIONAL. --------------------
  /**
   * The ATOMIC single-use claim for a SINGLE-USE OTP code (`otp.singleUse`). A
   * CREATE-IF-ABSENT conditional put of a `CtfOtpClaim` row keyed (challenge,
   * codeHash): `attribute_not_exists` on the key means the FIRST concurrent
   * claimer of a code wins (`claimed:true`); a code already consumed, the WINNER
   * re-submitting (row exists), or an ABSENT op all read as `claimed:false` — the
   * indistinguishable non-solve. `claimedBy` on a loss carries the winning user.
   *
   * Distinct from `claimCode` (Slice-3 wordlist), which is a PATCH-if-exists over a
   * PRE-LOADED pool — single-use OTP has NO pool (the valid code is live-generated
   * by TOTP), so the claim must CREATE the row. `ttl` is the DynamoDB TTL epoch
   * seconds so the consumed-code marker auto-expires.
   *
   * Catch discipline mirrors `claimSolve`/`claimCode`: a claim collision (row
   * present) ⇒ `{claimed:false, claimedBy}`; any OTHER error rethrows so
   * `judgeSolve` degrades to a non-solve rather than mis-report a win. NEVER log
   * the codeHash or guess. OPTIONAL so a store built only for the static/shared-otp
   * path stays type-clean.
   */
  claimOtpCode?(args: {
    challenge: string;
    codeHash: string;
    user: string;
    claimedAt: string;
    ttl: number;
  }): Promise<{ claimed: boolean; claimedBy?: string }>;
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
    /**
     * CTF operator override (front-door-resolved from CTF_ADMIN_GROUPS). When
     * true: the attempt cap is skipped AND an already-solved challenge is
     * RE-SCORED against the current config (idempotent net-delta) rather than
     * echoing the frozen prior award. Correctness is still required. Defaults
     * false — the judge never reads identity/roles from the guess.
     */
    admin?: boolean;
  },
  deps: { store?: CtfStore; now?: number; log?: (o: unknown) => void } = {},
): Promise<JudgeResult> {
  const store = deps.store ?? defaultStore;
  const now = deps.now ?? Date.now();
  const log = deps.log ?? emit;
  const { user, challenge, guess, guessHash, channel, admin = false } = input;

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
    // guess (covert invisibility — do NOT reveal the reason). Admins bypass the
    // cap entirely so they can iterate on a challenge without self-locking out
    // (main #619 — composes AFTER the unlock/window gates above, which still apply
    // to admins: an admin re-submit is a correctness+config test, not a gate skip).
    if (!admin) {
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
    // For `wordlist` (CTFT-13) the validation IS the atomic single-use claim: hash
    // the guess (or reuse a pre-hashed covert guessHash) to the codeHash — the same
    // hashAnswer seam admin-loaded codes use — then conditional-claim a matching
    // unclaimed CtfCode. Computed here so both the dispatch and the wordlist
    // finalize (which keys the ledger row by codeHash) read one value.
    const codeHash =
      ctf.answerType === "wordlist" ? (guessHash ?? hashAnswer(guess ?? "")) : "";
    let ok: boolean;
    if (ctf.answerType === "otp") {
      const otp = ctf.otp ?? {};
      // judgeSolve's `now` is epoch MILLISECONDS; verifyTotp wants unix SECONDS.
      ok = verifyTotp(otp.secret ?? "", guess ?? "", Math.floor(now / 1000), {
        digits: otp.digits,
        period: otp.period,
        skew: otp.skew,
      });
    } else if (ctf.answerType === "wordlist") {
      // The atomic conditional claim IS the answer check: a used/unknown code OR an
      // absent op ⇒ claimed:false ⇒ falls through the shared `if (!ok)` NON_SOLVE
      // below (indistinguishable from a wrong answer). Never log codeHash/guess.
      ok = store.claimCode
        ? (
            await store.claimCode({
              challenge,
              codeHash,
              user,
              claimedAt: new Date(now).toISOString(),
            })
          ).claimed
        : false;
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

    // (W) WORDLIST finalize (CTFT-13). Placed BEFORE the generic isRepeatable block
    // so wordlist NEVER calls claimScoreEvent — the CtfCode claim above already
    // provided the atomic single-use guarantee (calling the once-per-window claim
    // would wrongly block a player's second DISTINCT code in the same time bucket).
    // Mirrors the repeatable finalize (R3/R4) EXCEPT the idempotency source: the
    // code claim, not claimScoreEvent. The ledger row is keyed by `bucket: codeHash`
    // — each globally single-use code maps to exactly one scoring event. NOTE:
    // recordScoreEvent MUST create/upsert here (no claimScoreEvent pre-created a
    // row); defaultStore.recordScoreEvent is an upsert for exactly this reason (its
    // create-vs-patch semantics is not covered by the in-memory Map fake). No
    // perPlayerMax gate: the finite code pool + per-code single-use is the natural
    // bound, and a byUser count before recordScoreEvent would mis-order. Never pass
    // guess/codeHash to the logger.
    if (ctf.answerType === "wordlist") {
      const n = await store.allocateOrdinal(challenge);
      if ((ctf.globalMax ?? 0) > 0 && n > (ctf.globalMax as number)) {
        if (store.recordScoreEvent) {
          await store.recordScoreEvent({ challenge, user, bucket: codeHash, ordinal: n, points: 0, tierCeiling: activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax, channel });
        }
        log(ctfJudgeLog({ challenge, result: "capped" }));
        return { solved: true, points: 0, ordinal: n, firstBlood: false, capped: true };
      }
      const points = computePoints(n, ctf, now);
      const capped = points === 0;
      const firstBlood = n === 1;
      const tierCeiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax;
      if (store.recordScoreEvent) {
        await store.recordScoreEvent({ challenge, user, bucket: codeHash, ordinal: n, points, tierCeiling, channel });
      }
      await store.accrue({ user, points });
      log(ctfJudgeLog({ challenge, result: capped ? "capped" : "solve" }));
      return { solved: true, points, ordinal: n, firstBlood, capped, effect: points > 0 ? ctf.effect : undefined };
    }

    // (SU) SINGLE-USE OTP finalize (Phase 65, CTFT-17). Placed BEFORE the generic
    // isRepeatable block (guards are mutually exclusive; order is immaterial) so a
    // singleUse OTP flag NEVER falls into the per-player time-bucket path. Reached
    // only AFTER the step-4 verifyTotp gate above, so `ok` is already true here —
    // the code is a CURRENTLY-VALID TOTP and the claim only ever consumes a valid
    // code. The atomic CtfOtpClaim create-if-absent IS the single-use guard (like
    // the wordlist CtfCode claim), so this path NEVER calls claimScoreEvent, and
    // recordScoreEvent MUST upsert (defaultStore.recordScoreEvent already does — no
    // row pre-exists). No perPlayerMax gate: a globally single-use code is the
    // natural bound (mirrors the wordlist finalize). A lost/consumed code, the
    // WINNER re-submitting, or an absent op ALL return the SAME NON_SOLVE a wrong
    // code yields (indistinguishable) — and NEVER re-accrue (no double-award). Never
    // pass the guess/codeHash to the logger.
    if (ctf.answerType === "otp" && ctf.otp?.singleUse === true) {
      // OTP has no covert guessHash path (verifyTotp needs the raw code — see the
      // step-4 comment), so the claim key is hashed from the raw guess. Never log it.
      const otpHash = otpCodeHash(guess ?? "");
      const ttl = otpClaimTtlSeconds(now, ctf.otp);
      const claim = store.claimOtpCode
        ? await store.claimOtpCode({ challenge, codeHash: otpHash, user, claimedAt: scoredAt, ttl })
        : { claimed: false };
      if (!claim.claimed) {
        log(ctfJudgeLog({ challenge, result: "no-solve" }));
        return NON_SOLVE;
      }
      // Winner: score through the EXISTING codeHash-keyed ledger + accrue path,
      // mirroring the wordlist finalize R3/R4 verbatim.
      const n = await store.allocateOrdinal(challenge);
      if ((ctf.globalMax ?? 0) > 0 && n > (ctf.globalMax as number)) {
        if (store.recordScoreEvent) {
          await store.recordScoreEvent({ challenge, user, bucket: otpHash, ordinal: n, points: 0, tierCeiling: activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax, channel });
        }
        log(ctfJudgeLog({ challenge, result: "capped" }));
        return { solved: true, points: 0, ordinal: n, firstBlood: false, capped: true };
      }
      const points = computePoints(n, ctf, now);
      const capped = points === 0;
      const firstBlood = n === 1;
      const tierCeiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax;
      if (store.recordScoreEvent) {
        await store.recordScoreEvent({ challenge, user, bucket: otpHash, ordinal: n, points, tierCeiling, channel });
      }
      await store.accrue({ user, points });
      log(ctfJudgeLog({ challenge, result: capped ? "capped" : "solve" }));
      return { solved: true, points, ordinal: n, firstBlood, capped, effect: points > 0 ? ctf.effect : undefined };
    }

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
        if (store.recordScoreEvent) {
          await store.recordScoreEvent({ challenge, user, bucket, ordinal: n, points: 0, tierCeiling: activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax, channel });
        }
        log(ctfJudgeLog({ challenge, result: "capped" }));
        return { solved: true, points: 0, ordinal: n, firstBlood: false, capped: true };
      }
      // (R4) score + record the ledger row + accrue (exactly as CtfSolve accrues).
      const points = computePoints(n, ctf, now);
      const capped = points === 0;
      const firstBlood = n === 1;
      const tierCeiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax;
      if (store.recordScoreEvent) {
        await store.recordScoreEvent({ challenge, user, bucket, ordinal: n, points, tierCeiling, channel });
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

      // ADMIN OVERRIDE (main #619): re-score an already-solved challenge against the
      // CURRENT config so operators can verify a changed setup by resubmitting. Reuse
      // the existing ordinal (never bump Ctf.solveCount) and move ctfScore by the NET
      // DELTA only (ctfSolves untouched) — the board stays idempotent (unchanged
      // config → delta 0). Needs a usable prior ordinal; without one we cannot
      // safely re-score, so fall through to the plain replay below. (This is the
      // STATIC one-award path; repeatable/wordlist flags never reach here.)
      if (admin && prior && prior.ordinal >= 1) {
        const n = prior.ordinal;
        const points = computePoints(n, ctf, now);
        const capped = points === 0;
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
        await store.reaccrue({ user, delta: points - prior.points });
        log(ctfJudgeLog({ challenge, result: "re-score" }));
        return { solved: true, points, ordinal: n, firstBlood, capped };
      }

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
  floorAfterMax?: boolean;
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
    singleUse?: boolean;
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
  const answerType: "static" | "otp" | "wordlist" =
    row.answerType === "otp"
      ? "otp"
      : row.answerType === "wordlist"
        ? "wordlist"
        : "static";
  return {
    challenge: row.challenge,
    answerHash: row.answerHash ?? "",
    enabled: row.enabled ?? false,
    pointMax: row.pointMax ?? 0,
    pointFloor: row.pointFloor ?? 0,
    maxSolves: row.maxSolves ?? 0,
    floorAfterMax: row.floorAfterMax,
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
    ordinal,
    tierCeiling,
    channel,
  }) {
    // UPSERT (create-then-set), NOT patch. The normal repeatable path pre-creates
    // this row via `claimScoreEvent`, but the WORDLIST path bypasses that claim
    // (the CtfCode conditional IS its single-use guard) — so no row pre-exists
    // when the wordlist finalize records the ledger. A `.patch()` here would raise
    // ConditionalCheckFailed on the wordlist path → judge catch → NON_SOLVE, i.e.
    // a valid first-time code would be marked claimed yet score NOTHING. Upsert is
    // idempotent for the repeatable path too (the row is already present; set just
    // fills the score fields). NOTE: the in-memory Map test fake cannot exercise
    // this create-vs-patch distinction — it is confirmed here by reading the real
    // ElectroDB call (see the <verification> note in 56-02-PLAN).
    await CtfScoreEvent.upsert({ challenge, user, bucket })
      .set({ points, ordinal, tierCeiling, channel })
      .go();
  },

  // --- Wordlist single-use claim (flag-types Slice 3, CTFT-13). ---------------
  async claimCode({ challenge, codeHash, user, claimedAt }) {
    try {
      // Conditional update: set claimedBy/claimedAt IFF the row exists AND
      // claimedBy is unset. Two concurrent claimers of the same code collide on
      // `attribute_not_exists(claimedBy)` and EXACTLY one wins (no read-then-write
      // race). Never log codeHash/guess.
      await CtfCode.patch({ challenge, codeHash })
        .set({ claimedBy: user, claimedAt })
        .where((attr, op) => op.notExists(attr.claimedBy))
        .go();
      return { claimed: true };
    } catch (err) {
      // A condition failure means the code is already claimed OR the row does not
      // exist (unknown code) — both are "not claimable" ⇒ the indistinguishable
      // non-solve. If the row IS present AND still unclaimed, the failure was NOT a
      // claim collision — rethrow so judgeSolve degrades to a non-solve rather than
      // mis-report a win (mirrors claimSolve/claimScoreEvent catch discipline).
      const existing = await CtfCode.get({ challenge, codeHash }).go();
      if (existing.data && !existing.data.claimedBy) throw err;
      return { claimed: false };
    }
  },

  // --- Single-use OTP claim (Phase 65, CTFT-17). ------------------------------
  async claimOtpCode({ challenge, codeHash, user, claimedAt, ttl }) {
    try {
      // ElectroDB create adds attribute_not_exists on the (challenge, codeHash)
      // key → a conditional put. Two concurrent claimers of the SAME code collide
      // and EXACTLY one wins (no read-then-write race). claimedBy is written by the
      // winning create (there is no pre-loaded pool, unlike CtfCode). ttl is the
      // DynamoDB TTL so the consumed-code marker auto-expires. Never log codeHash/guess.
      await CtfOtpClaim.create({ challenge, codeHash, claimedBy: user, claimedAt, ttl }).go();
      return { claimed: true };
    } catch (err) {
      // A condition failure means the row already exists (code already consumed, or
      // the winner re-submitting). Read it to carry claimedBy. If NO row is present
      // the failure was NOT a claim collision — rethrow so judgeSolve degrades to a
      // non-solve rather than mis-report a win (mirrors claimSolve/claimCode).
      const existing = await CtfOtpClaim.get({ challenge, codeHash }).go();
      if (!existing.data) throw err;
      return { claimed: false, claimedBy: existing.data.claimedBy };
    }
  },

  async reaccrue({ user, delta }) {
    // Idempotent-friendly: a zero delta (unchanged config) writes nothing.
    // DynamoDB ADD accepts a negative operand, so a lowered ceiling decrements.
    // ctfSolves is deliberately left untouched — the solve count is unchanged.
    if (delta === 0) return;
    await RunUser.patch({ userId: user }).add({ ctfScore: delta }).go();
  },
};
