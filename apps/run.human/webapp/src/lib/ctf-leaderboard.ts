/**
 * CTF leaderboard read/assembly (Phase 47, CTF-11).
 *
 * SERVER-ONLY: imports the electro-backed entities (RunUser scan + CtfSolve
 * drill). Only import from server components / route handlers — never a
 * "use client" module — so the AWS SDK is never bundled to the browser (repo
 * convention; mirrors lib/qr-admin.ts and lib/admin-report.ts).
 *
 * Two reads back the leaderboard:
 *   - `scanAllRunUsers()` (Phase-43 reuse) → rank by `RunUser.ctfScore` desc.
 *     A full-table scan + in-memory sort is fine at event scale (hundreds of
 *     users), per the phase decision.
 *   - `CtfSolve.query.primary({ challenge })` → the per-challenge drill (all
 *     solvers of a challenge share a partition). Rows carry ordinal / points /
 *     firstBlood / channel / solvedAt; each user is one row.
 *
 * DISPLAY-NAME JOIN: CtfSolve.user and RunUser.userId can live in different
 * identifier namespaces (adapter uuid vs raw OIDC sub — see
 * reference_auth_id_namespace_mismatch). `joinSolveNames` falls back to the raw
 * user id when the scan map has no entry, so a namespace miss degrades to
 * showing the id rather than dropping the row.
 *
 * CSV formula-injection guard: run.human's shared `csvCell` (admin-report.ts)
 * only RFC-4180-quotes; it does NOT neutralize spreadsheet formulas. CTF
 * challenge names and runner displayNames are attacker-influenced, so the
 * leaderboard CSV additionally passes every cell through `guardFormula`
 * (OWASP rule) BEFORE the RFC-4180 quoter — composed as `csvCell(guardFormula(v))`
 * via `toCsv`. We do NOT fork/edit the shared csvCell (that would risk a
 * Phase-43 users-CSV regression); the guard is layered here, in this module.
 */

import { scanAllRunUsers, type RunUserItem } from "@/entities/run-user";
import { CtfSolve, type CtfSolveItem } from "@/entities/ctf";
import { toCsv } from "@/lib/admin-report";
import type { EnrichedRow } from "@/lib/ctf-leaderboard-ui";

export type { EnrichedRow } from "@/lib/ctf-leaderboard-ui";

/** One ranked row for the leaderboard table + CSV. */
export type LeaderboardRow = {
  userId: string;
  displayName: string;
  ctfScore: number;
  ctfSolves: number;
};

/** A CtfSolve row with the resolved runner name attached (drill view). */
export type NamedSolve = CtfSolveItem & { name: string };

/** Per-runner solve tallies, aggregated from the CtfSolve rows. */
export type RunnerAgg = {
  firstBloods: number;
  qr: number;
  covert: number;
  solves: number;
  points: number;
};

/** Top-of-board summary tiles. */
export type LeaderboardSummary = {
  solvers: number; // ranked runners (ctfScore > 0)
  solves: number; // total CtfSolve rows
  points: number; // sum of ctfScore across ranked runners
  firstBloods: number; // total first-blood rows
  challenges: number; // total challenges
  liveChallenges: number; // enabled challenges
  qr: number; // qr-channel solves
  covert: number; // covert-channel solves
};

/** One challenge's operational status (Challenges section). */
export type ChallengeStatusRow = {
  challenge: string;
  enabled: boolean;
  solveCount: number;
  maxSolves: number | null;
  capReached: boolean;
  points: number | null;
};

/** Minimal shape of a `listCtf()` row that `challengeStatus` consumes. */
type ChallengeLike = {
  challenge: string;
  enabled?: boolean;
  solveCount?: number;
  maxSolves?: number;
  points?: number;
};

/**
 * Pure: keep only users with a positive ctfScore, shape the row, and sort by
 * ctfScore descending. Array.prototype.sort is stable (V8/Node), so ties keep
 * their incoming order. Non-mutating.
 */
export function rankByScore(users: RunUserItem[]): LeaderboardRow[] {
  return users
    .filter((u) => (u.ctfScore ?? 0) > 0)
    .map((u) => ({
      userId: u.userId,
      displayName: u.displayName ?? "",
      ctfScore: u.ctfScore ?? 0,
      ctfSolves: u.ctfSolves ?? 0,
    }))
    .sort((a, b) => b.ctfScore - a.ctfScore);
}

/** Scan every RunUser and rank by ctfScore desc (Phase-43 scan reuse). */
export async function buildLeaderboard(): Promise<LeaderboardRow[]> {
  const users = await scanAllRunUsers();
  return rankByScore(users);
}

/**
 * All CtfSolve rows for one challenge (the drill-in), sorted by ordinal
 * ascending (gap-free solve order). Reads the challenge partition directly.
 */
export async function listCtfSolvesByChallenge(
  challenge: string
): Promise<CtfSolveItem[]> {
  const result = await CtfSolve.query.primary({ challenge }).go({ pages: "all" });
  return [...result.data].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
}

/** Pure: userId → displayName map from a scanned RunUser set (skips the nameless). */
export function nameMapFromUsers(
  users: RunUserItem[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of users) {
    if (u.displayName) map[u.userId] = u.displayName;
  }
  return map;
}

/**
 * Pure: attach `name` to each solve via the map, falling back to the raw user
 * id on a namespace miss (never drops a row). Non-mutating.
 */
export function joinSolveNames(
  solves: CtfSolveItem[],
  nameByUser: Record<string, string>
): NamedSolve[] {
  return solves.map((s) => ({ ...s, name: nameByUser[s.user] ?? s.user }));
}

/** Every CtfSolve row (all challenges) — the source for per-runner aggregates. */
export async function scanAllCtfSolves(): Promise<CtfSolveItem[]> {
  const result = await CtfSolve.scan.go({ pages: "all" });
  return result.data;
}

/**
 * All of one runner's solves across every challenge (the per-runner drill),
 * sorted by solvedAt ascending. Reads the byUser GSI (one partition per user).
 */
export async function listCtfSolvesByUser(
  user: string
): Promise<CtfSolveItem[]> {
  const result = await CtfSolve.query.byUser({ user }).go({ pages: "all" });
  return [...result.data].sort((a, b) =>
    (a.solvedAt ?? "").localeCompare(b.solvedAt ?? "")
  );
}

/**
 * PURE. Fold every CtfSolve row into a per-runner tally keyed by `user`
 * (== RunUser.userId; the judge writes the adapter id, see
 * reference_auth_id_namespace_mismatch). Non-mutating.
 */
export function aggregateSolvesByUser(
  solves: CtfSolveItem[]
): Record<string, RunnerAgg> {
  const agg: Record<string, RunnerAgg> = {};
  for (const s of solves) {
    const a = (agg[s.user] ??= {
      firstBloods: 0,
      qr: 0,
      covert: 0,
      solves: 0,
      points: 0,
    });
    a.solves += 1;
    a.points += s.points ?? 0;
    if (s.firstBlood) a.firstBloods += 1;
    if (s.channel === "qr") a.qr += 1;
    else if (s.channel === "covert") a.covert += 1;
  }
  return agg;
}

/**
 * PURE. Join the per-runner aggregate into the ranked rows (0-filled on a miss,
 * so a namespace mismatch degrades to no badge rather than a crash). Preserves
 * the incoming rank order. Non-mutating.
 */
export function enrichRows(
  rows: LeaderboardRow[],
  agg: Record<string, RunnerAgg>
): EnrichedRow[] {
  return rows.map((r) => {
    const a = agg[r.userId];
    return {
      ...r,
      firstBloods: a?.firstBloods ?? 0,
      qr: a?.qr ?? 0,
      covert: a?.covert ?? 0,
    };
  });
}

/**
 * PURE. Roll the standings + raw solves + challenge list into the summary tiles.
 * `points`/`solvers` come from the RunUser rollups (the authoritative score);
 * `solves`/`firstBloods`/`qr`/`covert` come from the CtfSolve rows.
 */
export function summarize(
  rows: LeaderboardRow[],
  solves: CtfSolveItem[],
  challenges: ChallengeLike[]
): LeaderboardSummary {
  return {
    solvers: rows.length,
    solves: solves.length,
    points: rows.reduce((n, r) => n + (r.ctfScore ?? 0), 0),
    firstBloods: solves.filter((s) => s.firstBlood).length,
    challenges: challenges.length,
    liveChallenges: challenges.filter((c) => c.enabled !== false).length,
    qr: solves.filter((s) => s.channel === "qr").length,
    covert: solves.filter((s) => s.channel === "covert").length,
  };
}

/**
 * PURE, non-mutating. Shape each challenge into a status row (cap = solveCount
 * vs maxSolves) and sort by challenge name. `capReached` is true only when a
 * positive maxSolves is met or exceeded.
 */
export function challengeStatus(
  challenges: ChallengeLike[]
): ChallengeStatusRow[] {
  return [...challenges]
    .map((c) => {
      const solveCount = c.solveCount ?? 0;
      const maxSolves =
        typeof c.maxSolves === "number" ? c.maxSolves : null;
      return {
        challenge: c.challenge,
        enabled: c.enabled !== false,
        solveCount,
        maxSolves,
        capReached: maxSolves !== null && maxSolves > 0 && solveCount >= maxSolves,
        points: typeof c.points === "number" ? c.points : null,
      };
    })
    .sort((a, b) => a.challenge.localeCompare(b.challenge));
}

/**
 * OWASP formula-injection guard (PURE). Prefixes a single apostrophe when the
 * stringified value begins with a formula-trigger char (`= + - @`, TAB, or CR)
 * so a spreadsheet app treats the cell as text, not a formula. Benign values are
 * returned unchanged; null/undefined → "".
 */
export function guardFormula(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const CSV_COLUMNS: { key: string; header: string }[] = [
  { key: "rank", header: "Rank" },
  { key: "displayName", header: "Runner" },
  { key: "userId", header: "User ID" },
  { key: "ctfScore", header: "Score" },
  { key: "ctfSolves", header: "Solves" },
  { key: "firstBloods", header: "First bloods" },
  { key: "qr", header: "QR solves" },
  { key: "covert", header: "Covert solves" },
];

/**
 * Serialize the ranking to CSV. Every cell is passed through `guardFormula`
 * first, then the shared `toCsv`/`csvCell` RFC-4180 quoter — i.e.
 * `csvCell(guardFormula(v))` — so attacker-influenced names are BOTH
 * formula-neutralized AND correctly quoted. PURE. Accepts enriched rows so the
 * export carries the first-blood + channel breakdown shown on the board.
 */
export function leaderboardCsv(rows: EnrichedRow[]): string {
  const guarded = rows.map((r, i) => ({
    rank: guardFormula(i + 1),
    displayName: guardFormula(r.displayName),
    userId: guardFormula(r.userId),
    ctfScore: guardFormula(r.ctfScore),
    ctfSolves: guardFormula(r.ctfSolves),
    firstBloods: guardFormula(r.firstBloods),
    qr: guardFormula(r.qr),
    covert: guardFormula(r.covert),
  }));
  return toCsv(CSV_COLUMNS, guarded);
}
