/**
 * ctf-unsolve.ts — pure decision logic for the admin "unsolve / zero" action.
 *
 * The admin CTF board (`/admin/leaderboard`) surfaces two destructive operator
 * actions, both a UI wrapper around the same shape as scripts/reset-ctf-user.mts:
 *
 *   - ZERO a whole user   → delete every CtfSolve/CtfScoreEvent/CtfAttempt row
 *                           for the user and set ctfScore/ctfSolves to 0.
 *   - UNSOLVE one challenge → delete that challenge's rows for the user and
 *                             decrement the counters by exactly what was removed.
 *
 * Two things carry real risk and are worth proving in isolation from DynamoDB:
 *
 *   1. Counter math must FLOOR at 0. DynamoDB atomic ADD cannot clamp, so the
 *      executor read-modify-writes through {@link computeCounterUpdate} — a
 *      decrement can never persist a negative score/solve count (mirrors
 *      updateRunUserActivityCounts).
 *
 *   2. Ctf.solveCount / ordinal integrity. Deleting a solve must NOT rewind
 *      solveCount when OTHER runners still hold solves on that challenge — that
 *      would corrupt their ordinals. solveCount is reset to 0 ONLY where the
 *      target was the SOLE solver, so a fresh re-solve replays ordinal #1 /
 *      first-blood (exactly the guard reset-ctf-user.mts applies).
 *
 * Both are pure and side-effect free; the ElectroDB orchestration lives in
 * ctf-unsolve-store.ts behind these decisions.
 */

export type UnsolveMode = "user" | "challenge";

export interface CounterUpdateInput {
  mode: UnsolveMode;
  /** Sum of `points` across every row being deleted (CtfSolve + CtfScoreEvent). */
  removedPoints: number;
  /** Number of CtfSolve rows deleted (1 for a challenge unsolve, N for a user zero). */
  removedSolves: number;
  /** The user's current RunUser.ctfScore before the removal. */
  currentScore: number;
  /** The user's current RunUser.ctfSolves before the removal. */
  currentSolves: number;
}

export interface CounterUpdate {
  nextScore: number;
  nextSolves: number;
}

/**
 * Next RunUser.ctfScore / ctfSolves after an unsolve.
 *
 * - `user` mode zeroes both outright (a full reset — no arithmetic to drift).
 * - `challenge` mode subtracts exactly what was removed, floored at 0 so a stale
 *   or double-clicked decrement can never push a counter negative.
 */
export function computeCounterUpdate(input: CounterUpdateInput): CounterUpdate {
  if (input.mode === "user") {
    return { nextScore: 0, nextSolves: 0 };
  }
  return {
    nextScore: Math.max(0, input.currentScore - input.removedPoints),
    nextSolves: Math.max(0, input.currentSolves - input.removedSolves),
  };
}

/**
 * Of the challenges the target is being unsolved on, which may have their
 * `Ctf.solveCount` reset to 0.
 *
 * `solverCountByChallenge[c]` is the TOTAL number of CtfSolve rows on challenge
 * `c` (the target inclusive) BEFORE the delete. The target is the sole solver
 * iff that total is exactly 1 — only then is resetting solveCount safe. A
 * challenge with 2+ solvers is left untouched so surviving solvers keep their
 * ordinals gap-free. A count of 0 (no Ctf row / already clean) is never reset.
 */
export function soleSolverChallenges(
  targetChallenges: readonly string[],
  solverCountByChallenge: Readonly<Record<string, number>>
): string[] {
  return targetChallenges.filter((c) => (solverCountByChallenge[c] ?? 0) === 1);
}

/** A row carrying an optional numeric `points` (CtfSolve or CtfScoreEvent). */
export interface PointRow {
  challenge: string;
  points?: number;
}

/**
 * Sum the `points` across a set of rows (missing/NaN points count as 0). Used to
 * compute `removedPoints` for a challenge unsolve from the exact rows deleted,
 * so repeatable-flag score-event points are subtracted too — not just the single
 * CtfSolve row's points.
 */
export function sumPoints(rows: readonly PointRow[]): number {
  return rows.reduce((acc, r) => acc + (Number.isFinite(r.points) ? (r.points as number) : 0), 0);
}
