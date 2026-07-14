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

/** One ranked row for the leaderboard table + CSV. */
export type LeaderboardRow = {
  userId: string;
  displayName: string;
  ctfScore: number;
  ctfSolves: number;
};

/** A CtfSolve row with the resolved runner name attached (drill view). */
export type NamedSolve = CtfSolveItem & { name: string };

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
];

/**
 * Serialize the ranking to CSV. Every cell is passed through `guardFormula`
 * first, then the shared `toCsv`/`csvCell` RFC-4180 quoter — i.e.
 * `csvCell(guardFormula(v))` — so attacker-influenced names are BOTH
 * formula-neutralized AND correctly quoted. PURE.
 */
export function leaderboardCsv(rows: LeaderboardRow[]): string {
  const guarded = rows.map((r, i) => ({
    rank: guardFormula(i + 1),
    displayName: guardFormula(r.displayName),
    userId: guardFormula(r.userId),
    ctfScore: guardFormula(r.ctfScore),
    ctfSolves: guardFormula(r.ctfSolves),
  }));
  return toCsv(CSV_COLUMNS, guarded);
}
