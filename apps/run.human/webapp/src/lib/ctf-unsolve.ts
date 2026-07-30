/**
 * ctf-unsolve.ts — pure decision logic for the admin "unsolve / zero" action.
 *
 * The admin CTF board (`/admin/leaderboard`) surfaces two destructive operator
 * actions, both a UI wrapper around the same shape as scripts/reset-ctf-user.mts:
 *
 *   - ZERO a whole user   → delete every CtfSolve/CtfScoreEvent/CtfAttempt row
 *                           for the user, then rescore them (lib/rescore.ts).
 *   - UNSOLVE one challenge → delete that challenge's rows for the user, then
 *                             rescore them.
 *
 * points-consistency (2026-07-30): the counter arithmetic that used to live
 * here (`computeCounterUpdate`/`sumPoints`) is gone — rescoreUser re-derives
 * RunUser's score fields from the post-delete ledger, so there is no manual
 * floor-at-0 subtraction to prove. What's still worth proving in isolation
 * from DynamoDB is Ctf.solveCount / ordinal integrity: deleting a solve must
 * NOT rewind solveCount when OTHER runners still hold solves on that
 * challenge — that would corrupt their ordinals. solveCount is reset to 0
 * ONLY where the target was the SOLE solver, so a fresh re-solve replays
 * ordinal #1 / first-blood (exactly the guard reset-ctf-user.mts applies).
 *
 * Pure and side-effect free; the ElectroDB orchestration lives in
 * ctf-unsolve-store.ts behind this decision.
 */

export type UnsolveMode = "user" | "challenge";

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
