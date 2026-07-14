/**
 * Pure leaderboard assembly + cache-staleness core (LDBR-07, Phase 51).
 *
 * This is the independently-testable heart of the leaderboard API: given a set
 * of scanned user rows it ranks them over the FULL sorted list, then narrows the
 * returned page with an optional display filter and paginates — so a filtered
 * view still reports each runner's TRUE global rank (DC33 behavior, SC #2).
 *
 * It is intentionally PURE — no DynamoDB, no network, no entity/ORM coupling.
 * The only imports are the Phase-49 scoring functions (`globalScore`,
 * `rankComparator`) and the `RunUserItem` TYPE (for `mqttUsertype` reuse). The
 * route handlers in plans 02/03 are thin shells: gate → (cache) → scan →
 * buildLeaderboard → JSON.
 *
 * PRIVACY: the output `LeaderboardRow` DTO projects ONLY score/count/name/class
 * fields — never email or any other PII off the scanned row (threat T-51-01,
 * mirrors the Phase-49 no-PII scoring shape T-49-04).
 */

import { globalScore, rankComparator } from "@/lib/leaderboard-scoring";
import type { RunUserItem } from "@/entities/run-user";

/**
 * Input row shape for the leaderboard. A superset of the scoring `ScorableUser`
 * plus the display fields the board renders. Every field except `userId` is
 * optional — and `ctfScore`/`ctfSolves` (CTF-owned, LDBR-12) are optional too —
 * so a plain scanned `RunUserItem` (which does not declare the CTF fields) is
 * assignable to `LeaderboardUser` with ZERO casts. That assignability is what
 * keeps the plan-02 route tsc-clean.
 */
export type LeaderboardUser = {
  userId: string;
  displayName?: string;
  /** Reuse the RunUserItem class enum so scan rows assign without a cast. */
  mqttUsertype?: RunUserItem["mqttUsertype"];
  activityScore?: number;
  activityCounts?: { checkin?: number; gpx?: number };
  latestActivityAt?: number;
  createdAt?: number;
  /** Read-only CTF rollup, owned by the CTF judge worktree (LDBR-12). */
  ctfScore?: number;
  /** Read-only CTF solve count, owned by the CTF judge worktree (LDBR-12). */
  ctfSolves?: number;
};

/**
 * Lean output DTO for one leaderboard entry. Carries NO email/PII field
 * (threat T-51-01). `globalRank` is the rank over the full sorted set.
 */
export type LeaderboardRow = {
  globalRank: number;
  userId: string;
  displayName?: string;
  mqttUsertype?: RunUserItem["mqttUsertype"];
  globalScore: number;
  activityCounts: { checkin: number; gpx: number };
  ctfSolves: number;
};

export type LeaderboardResult = {
  rows: LeaderboardRow[];
  total: number;
  page: number;
  limit: number;
};

export type BuildLeaderboardOptions = {
  page?: number;
  limit?: number;
  filter?: string;
  /** When true, drop runners still on the auto-generated `rabbit_XXXX` default
   *  name (i.e. keep only those who have SET a name). Applied after ranking. */
  namedOnly?: boolean;
};

const DEFAULT_LIMIT = 25;

/**
 * True iff a runner has SET a custom display name — i.e. it is NOT the
 * auto-generated default `rabbit_XXXX` assigned at signup (see run-user.ts
 * `upsertRunUser`). Empty/blank names count as NOT custom. Backs the
 * "named only" board filter.
 */
export function hasCustomName(displayName?: string): boolean {
  const name = displayName?.trim() ?? "";
  return name.length > 0 && !name.toLowerCase().startsWith("rabbit_");
}

/**
 * Assemble the leaderboard from scanned rows.
 *
 * 1. Sort a COPY with the Phase-49 `rankComparator` (never mutate the input).
 * 2. Map to lean DTOs, assigning `globalRank = index + 1` over the FULL set.
 * 3. Apply the optional case-insensitive displayName-contains filter AFTER
 *    ranking — the filter narrows the returned page, never the rank (SC #2).
 * 4. Paginate the filtered rows (defaults: page 1, limit 25).
 */
export function buildLeaderboard(
  users: LeaderboardUser[],
  opts: BuildLeaderboardOptions = {}
): LeaderboardResult {
  // 1. Rank over the full set — sort a copy so the caller's array is untouched.
  const ranked: LeaderboardRow[] = [...users]
    .sort(rankComparator)
    .map((u, index) => ({
      globalRank: index + 1,
      userId: u.userId,
      displayName: u.displayName,
      mqttUsertype: u.mqttUsertype,
      globalScore: globalScore(u),
      activityCounts: {
        checkin: u.activityCounts?.checkin ?? 0,
        gpx: u.activityCounts?.gpx ?? 0,
      },
      ctfSolves: u.ctfSolves ?? 0,
    }));

  // 3. Filter AFTER ranking so globalRank stays global (T-51-02). "namedOnly"
  //    and the text filter compose (AND); both narrow the page, not the rank.
  const filter = opts.filter?.trim().toLowerCase();
  const filtered = ranked.filter((r) => {
    if (opts.namedOnly && !hasCustomName(r.displayName)) return false;
    if (filter && !(r.displayName ?? "").toLowerCase().includes(filter)) return false;
    return true;
  });

  // 4. Paginate.
  const page = Math.max(1, opts.page ?? 1);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const start = (page - 1) * limit;
  const rows = filtered.slice(start, start + limit);

  return { rows, total: filtered.length, page, limit };
}

/**
 * DC33 60s cache TTL (parity). Named constant so the boundary is one source.
 */
export const LEADERBOARD_CACHE_TTL_MS = 60_000;

/**
 * Pure cache-staleness boundary check (SC #3 core). Returns true when the entry
 * is STRICTLY older than the TTL — at exactly the TTL it is still fresh. No
 * clock dependency: the caller supplies both `now` and `fetchedAt`.
 */
export function isStale(
  now: number,
  fetchedAt: number,
  ttl: number = LEADERBOARD_CACHE_TTL_MS
): boolean {
  return now - fetchedAt > ttl;
}
