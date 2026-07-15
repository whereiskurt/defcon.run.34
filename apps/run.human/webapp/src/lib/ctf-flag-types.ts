/**
 * Flag-types pure helpers (Slice 1a, CTFT-01/03/06) — pure, no I/O, no electro.
 *
 * These are structurally typed (they do NOT import the `Ctf` entity) so they stay
 * parallel-safe and unit-testable offline. The judge (53-03) and the admin write
 * guard (qr-admin.upsertCtf) consume them:
 *   - isRepeatable   → routes a solve to CtfScoreEvent (repeatable) vs CtfSolve.
 *   - scoreBucket    → the time-window token that lives in the CtfScoreEvent sk,
 *                      making the once-per-window claim a single conditional put.
 *   - assertAnswerTypeTransition → CTFT-06 edit-semantics guard (D-07): flipping
 *                      a flag's repeatable-ness once solves exist is rejected.
 *
 * Only QrValidationError is imported (from the dependency-free ./qr-errors), so
 * this module never pulls in the electro client.
 */
import { QrValidationError } from "@/lib/qr-errors";

/** The subset of a Ctf row that decides repeatable-ness / bucketing. */
export interface FlagTypeShape {
  answerType?: string;
  perPlayerMax?: number;
  perPlayerIntervalHours?: number;
}

/**
 * A flag is REPEATABLE (scores onto CtfScoreEvent, NOT the once-ever CtfSolve) when
 * it is an OTP flag, a WORDLIST flag, OR allows more than one scoring solve per
 * player, OR sets a per-player cadence interval. A plain static one-award flag
 * (none of these) is NOT repeatable and keeps using CtfSolve.
 *
 * Wordlist (Slice 3, CTFT-13) is repeatable because a player may redeem multiple
 * DISTINCT single-use codes — each writes its own CtfScoreEvent ledger row (keyed
 * by the codeHash), never the once-ever CtfSolve. Marking it repeatable also makes
 * the CTFT-06 flip guard treat static↔wordlist as a genuine repeatable-ness change.
 */
export function isRepeatable(ctf: FlagTypeShape): boolean {
  return (
    ctf.answerType === "otp" ||
    ctf.answerType === "wordlist" ||
    (ctf.perPlayerMax ?? 0) > 1 ||
    (ctf.perPlayerIntervalHours ?? 0) > 0
  );
}

/** Fallback window (seconds) when neither an interval nor an OTP period is set. */
const DEFAULT_BUCKET_SECONDS = 120;

/**
 * Floor `scoredAtMs` to the flag's scoring window and return a stable string
 * token. Two timestamps in the same window return the SAME token; adjacent
 * windows differ. The window is `perPlayerIntervalHours * 3600` when set (it
 * dominates), else the OTP `otpPeriodSeconds` for tighter rotating flags, else a
 * documented 120s fallback. The token is the CtfScoreEvent `bucket` composite —
 * so the once-per-window claim collides atomically on `attribute_not_exists(sk)`.
 */
export function scoreBucket(
  scoredAtMs: number,
  opts: { perPlayerIntervalHours?: number; otpPeriodSeconds?: number }
): string {
  const windowSeconds =
    (opts.perPlayerIntervalHours ?? 0) > 0
      ? (opts.perPlayerIntervalHours as number) * 3600
      : (opts.otpPeriodSeconds ?? 0) > 0
        ? (opts.otpPeriodSeconds as number)
        : DEFAULT_BUCKET_SECONDS;
  const scoredAtSeconds = Math.floor(scoredAtMs / 1000);
  return String(Math.floor(scoredAtSeconds / windowSeconds));
}

/**
 * Overlay a partial edit's flag-type fields onto the stored row to produce the
 * persisted next-state for the D-07 repeatable-ness decision. Mirrors
 * `qr-admin.ctfAttributes`' no-clobber contract exactly: an omitted (nullish)
 * field preserves the stored value (`??` — none of these fields clobber on a
 * falsy value like `0`/`""`), so a partial edit that never touches
 * `answerType`/`perPlayerMax`/`perPlayerIntervalHours` is NOT read as a flip. A
 * genuine flip still sets one of these fields, so it is still caught. This is the
 * correct `next` to hand `assertAnswerTypeTransition` — the raw partial `input`
 * is NOT, because its omitted fields read as `undefined` (⇒ non-repeatable).
 */
export function mergeFlagTypeNextState(
  existing: FlagTypeShape,
  input: FlagTypeShape
): FlagTypeShape {
  return {
    answerType: input.answerType ?? existing.answerType,
    perPlayerMax: input.perPlayerMax ?? existing.perPlayerMax,
    perPlayerIntervalHours:
      input.perPlayerIntervalHours ?? existing.perPlayerIntervalHours,
  };
}

/**
 * CTFT-06 (D-07) edit-semantics guard. Throws when a challenge's repeatable-ness
 * would flip (static <-> repeatable) AND scoring history already exists — because
 * history would then split across CtfSolve (static) and CtfScoreEvent (repeatable)
 * with no coherent merge. A flip is allowed when no solves exist yet, and any edit
 * that leaves repeatable-ness unchanged is always a no-op here.
 */
export function assertAnswerTypeTransition(
  existing: FlagTypeShape,
  next: FlagTypeShape,
  hasSolves: boolean
): void {
  if (!hasSolves) return;
  if (isRepeatable(existing) === isRepeatable(next)) return;
  throw new QrValidationError(
    "Cannot change this challenge between static and repeatable once solves " +
      "exist — the scoring history would split across CtfSolve and " +
      "CtfScoreEvent. Reset the challenge's solves first, or create a new " +
      "challenge for the new answer type."
  );
}
