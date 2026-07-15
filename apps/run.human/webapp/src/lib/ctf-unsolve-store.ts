import { CtfSolve, CtfScoreEvent, CtfAttempt } from "@/entities/ctf";
import { Ctf } from "@/entities/qr";
import { RunUser, getRunUser } from "@/entities/run-user";
import { normalizeChallenge } from "@/lib/qr-admin";
import {
  computeCounterUpdate,
  soleSolverChallenges,
  sumPoints,
  type UnsolveMode,
} from "@/lib/ctf-unsolve";

/**
 * ctf-unsolve-store.ts — the ElectroDB orchestration behind the admin
 * "unsolve / zero" board actions. Server-only; never import into a client
 * component. The risky decisions (floored counter math, sole-solver solveCount
 * guard) live in the pure ctf-unsolve.ts; this module only reads the target's
 * rows, applies the plan, and reports what it did.
 *
 * Two operations, both mirroring scripts/reset-ctf-user.mts through the webapp
 * entity path (not the raw-SDK script trick):
 *
 *   unsolveUser(userId)              — full reset: delete every CtfSolve +
 *                                      CtfScoreEvent + CtfAttempt row for the
 *                                      user, set ctfScore/ctfSolves to 0.
 *   unsolveChallenge(userId, slug)   — delete just that challenge's rows and
 *                                      decrement the counters by exactly what
 *                                      was removed (floored at 0).
 *
 * In BOTH, Ctf.solveCount is reset to 0 ONLY on challenges where the target was
 * the SOLE solver (so a re-solve replays ordinal #1); a challenge others still
 * hold solves on is left untouched to keep their ordinals gap-free.
 *
 * The identity key throughout is the RunUser.userId / CtfSolve.user space
 * (= session.user.id — the CTF identity invariant), NOT the OIDC sub.
 */

export interface UnsolveResult {
  mode: UnsolveMode;
  userId: string;
  challenge?: string;
  removedSolves: number;
  removedScoreEvents: number;
  removedAttempts: number;
  nextScore: number;
  nextSolves: number;
  /** Challenges whose Ctf.solveCount was reset to 0 (target was sole solver). */
  solveCountReset: string[];
}

type SolveRow = { challenge: string; user: string; points?: number };
type ScoreEventRow = { challenge: string; user: string; bucket: string; points?: number };
type AttemptRow = { challenge: string; user: string };

/** Total CtfSolve rows per challenge (target inclusive) — the sole-solver test input. */
async function solverCounts(challenges: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of challenges) {
    const res = await CtfSolve.query.primary({ challenge: c }).go({ pages: "all" });
    out[c] = res.data.length;
  }
  return out;
}

/** Best-effort delete of the (challenge, user) CtfAttempt rate-limit rows. */
async function deleteAttempts(userId: string, challenges: string[]): Promise<number> {
  let removed = 0;
  for (const challenge of challenges) {
    // Single round trip: delete is idempotent, and `all_old` tells us whether a
    // row actually existed (so removedAttempts stays an honest count) without a
    // separate get.
    const res = await CtfAttempt.delete({ challenge, user: userId }).go({
      response: "all_old",
    });
    if (res.data) removed++;
  }
  return removed;
}

async function applyPlan(
  userId: string,
  mode: UnsolveMode,
  solves: SolveRow[],
  scoreEvents: ScoreEventRow[],
): Promise<UnsolveResult> {
  // Challenges the target touched (solve OR repeatable score event) — drives the
  // attempt cleanup and the sole-solver solveCount reset.
  const touched = Array.from(
    new Set([...solves.map((s) => s.challenge), ...scoreEvents.map((e) => e.challenge)])
  );

  // Counts BEFORE any delete — the sole-solver test must see the pre-delete world.
  const counts = await solverCounts(touched);

  const user = await getRunUser(userId);
  const { nextScore, nextSolves } = computeCounterUpdate({
    mode,
    removedPoints: sumPoints([...solves, ...scoreEvents]),
    // The judge's accrue() does `.add({ ctfScore, ctfSolves: 1 })` for EACH
    // scoring write — one per CtfSolve (static flags) AND one per CtfScoreEvent
    // (repeatable/OTP/wordlist flags). So the ctfSolves decrement must count both
    // ledgers, else a repeatable challenge (0 CtfSolve rows, N score events)
    // leaves ctfSolves inflated by N after an unsolve.
    removedSolves: solves.length + scoreEvents.length,
    currentScore: user?.ctfScore ?? 0,
    currentSolves: user?.ctfSolves ?? 0,
  });

  // Delete rows: CtfSolve, then CtfScoreEvent, then CtfAttempt.
  for (const s of solves) {
    await CtfSolve.delete({ challenge: s.challenge, user: userId }).go();
  }
  for (const e of scoreEvents) {
    await CtfScoreEvent.delete({ challenge: e.challenge, user: userId, bucket: e.bucket }).go();
  }
  const removedAttempts = await deleteAttempts(userId, touched);

  // Counters. RunUser may not exist for a phantom id — skip rather than create one.
  if (user) {
    await RunUser.patch({ userId }).set({ ctfScore: nextScore, ctfSolves: nextSolves }).go();
  }

  // Sole-solver solveCount reset (guarded; never rewinds a shared challenge).
  // ElectroDB .patch() asserts the item exists, so skip a challenge whose Ctf
  // config row was deleted while a solve lingered (mirrors reset-ctf-user.mts's
  // `if (ctfRows[0])` guard) rather than 500-ing the whole action.
  const candidates = soleSolverChallenges(touched, counts);
  const solveCountReset: string[] = [];
  for (const challenge of candidates) {
    const ctf = await Ctf.get({ challenge }).go();
    if (!ctf.data) continue;
    await Ctf.patch({ challenge }).set({ solveCount: 0 }).go();
    solveCountReset.push(challenge);
  }

  // If the RunUser row is absent, no counter patch ran — but currentScore was
  // read as 0 above, so nextScore/nextSolves are already 0 and honest to report.
  return {
    mode,
    userId,
    removedSolves: solves.length,
    removedScoreEvents: scoreEvents.length,
    removedAttempts,
    nextScore,
    nextSolves,
    solveCountReset,
  };
}

/** Full reset — zero the user everywhere on the board. */
export async function unsolveUser(userId: string): Promise<UnsolveResult> {
  const [solvesRes, eventsRes] = await Promise.all([
    CtfSolve.query.byUser({ user: userId }).go({ pages: "all" }),
    CtfScoreEvent.query.byUser({ user: userId }).go({ pages: "all" }),
  ]);
  return applyPlan(
    userId,
    "user",
    solvesRes.data as SolveRow[],
    eventsRes.data as ScoreEventRow[],
  );
}

/** Unsolve exactly one challenge for one user (decrement, don't zero). */
export async function unsolveChallenge(
  userId: string,
  rawChallenge: string,
): Promise<UnsolveResult> {
  const challenge = normalizeChallenge(rawChallenge);
  const [solvesRes, eventsRes] = await Promise.all([
    CtfSolve.query.byUser({ user: userId }).go({ pages: "all" }),
    CtfScoreEvent.query.byUser({ user: userId }).go({ pages: "all" }),
  ]);
  const solves = (solvesRes.data as SolveRow[]).filter((s) => s.challenge === challenge);
  const events = (eventsRes.data as ScoreEventRow[]).filter((e) => e.challenge === challenge);
  const result = await applyPlan(userId, "challenge", solves, events);
  return { ...result, challenge };
}

export type { AttemptRow };
