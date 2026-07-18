/**
 * ctf-solve-merge.ts — PURE union of the two CTF scoring ledgers for the admin
 * leaderboard read layer.
 *
 * The judge records a solve in ONE of two places (see ctf-judge.ts):
 *   - static flags        → a once-ever `CtfSolve` row (carries ordinal + firstBlood)
 *   - OTP / wordlist /     → `CtfScoreEvent` rows (one per scoring window/bucket;
 *     repeatable flags        NO gap-free ordinal, NO first-blood marker)
 *
 * The board's drills, summary tiles, channel counts, and first-blood tallies
 * historically scanned `CtfSolve` ONLY, so any `CtfScoreEvent` solve was invisible
 * there — even though the RunUser-backed standings scored it correctly (the
 * accrue path increments ctfScore/ctfSolves for BOTH ledgers). That split is the
 * bug these helpers close: normalize each `CtfScoreEvent` into the `CtfSolve`
 * view and concatenate, so every downstream aggregator counts both.
 *
 * `import type` keeps this module runtime-pure (the ElectroDB/AWS chain is NOT
 * pulled in), so it unit-tests without the server entity graph — same discipline
 * as ctf-seed-rows.ts.
 */
import type { CtfSolveItem, CtfScoreEventItem } from "@/entities/ctf";

/**
 * PURE. Normalize a `CtfScoreEvent` into the `CtfSolve` view the leaderboard
 * renders. `scoredAt` becomes `solvedAt`; `points`/`channel` carry over. Ordinal
 * and firstBlood are left ABSENT (score events have neither) so the drill renders
 * "—" rather than a fake `0` / `false` badge. Non-mutating.
 */
export function scoreEventToSolve(event: CtfScoreEventItem): CtfSolveItem {
  return {
    challenge: event.challenge,
    user: event.user,
    points: event.points,
    channel: event.channel,
    solvedAt: event.scoredAt,
  };
}

/**
 * PURE. Union the CtfSolve rows with the normalized CtfScoreEvent rows into one
 * solve list. The two ledgers are mutually exclusive per (flag, solve) — a flag
 * is either static (CtfSolve) or flag-typed (CtfScoreEvent) — so a plain
 * concatenation neither double-counts nor drops. Each score event stays its own
 * row, so a repeatable flag's N windows read as N solves. Non-mutating.
 */
export function mergeSolveLedgers(
  solves: CtfSolveItem[],
  events: CtfScoreEventItem[]
): CtfSolveItem[] {
  return [...solves, ...events.map(scoreEventToSolve)];
}
