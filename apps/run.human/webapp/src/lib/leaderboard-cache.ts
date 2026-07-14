/**
 * 60s in-memory stale-while-revalidate scan cache (LDBR-07, Phase 51, SC #3).
 *
 * A DC33 port (`app/api/leaderboard/route.ts`) down to the in-memory essentials —
 * the dev file-cache is intentionally DROPPED (YAGNI, simplicity-first). It
 * bounds how often the expensive full-table `RunUser` scan runs and, crucially,
 * NEVER blocks a request on a refresh:
 *   - cold call (no data yet)  → awaits the scan once, then caches;
 *   - within TTL               → serves the cached rows, no re-scan;
 *   - past TTL                 → serves the STALE rows synchronously and fires a
 *                                single non-awaited background refresh.
 *
 * The scanner is INJECTED by the caller (never imported here) so the cache is
 * trivially testable with a stub and carries no entity/DynamoDB coupling — only
 * the `RunUserItem` TYPE and the one TTL source of truth (`isStale` +
 * `LEADERBOARD_CACHE_TTL_MS`) from the pure plan-01 core.
 *
 * Server-only, module-level singleton (one cache per Node process/lambda warm
 * container — the same lifetime DC33 relied on).
 */

import { isStale } from "@/lib/leaderboard-data";
import type { RunUserItem } from "@/entities/run-user";

type CacheState = {
  data: RunUserItem[] | null;
  fetchedAt: number;
  refreshing: boolean;
};

const cache: CacheState = {
  data: null,
  fetchedAt: 0,
  refreshing: false,
};

/**
 * Fire a background refresh at most once at a time (single-flight guard). The
 * scan runs WITHOUT being awaited by the caller; on resolve it swaps in the new
 * rows, and any error is swallowed/logged so a failed refresh never rejects a
 * request that was served stale data.
 */
function refreshInBackground(scan: () => Promise<RunUserItem[]>): void {
  if (cache.refreshing) return;
  cache.refreshing = true;
  void Promise.resolve()
    .then(() => scan())
    .then((rows) => {
      cache.data = rows;
      cache.fetchedAt = Date.now();
    })
    .catch((err) => {
      console.error("[leaderboard-cache] background refresh failed:", err);
    })
    .finally(() => {
      cache.refreshing = false;
    });
}

/**
 * Return the cached scan rows, refreshing per the stale-while-revalidate policy.
 *
 * @param scan the (injected) full-table scanner, e.g. `scanAllRunUsers`.
 */
export async function getCachedScan(
  scan: () => Promise<RunUserItem[]>
): Promise<RunUserItem[]> {
  // Cold path — the ONLY path that blocks a request on the scan.
  if (cache.data === null) {
    cache.data = await scan();
    cache.fetchedAt = Date.now();
    return cache.data;
  }

  // Past TTL — serve stale immediately, kick a single background refresh.
  if (isStale(Date.now(), cache.fetchedAt) && !cache.refreshing) {
    refreshInBackground(scan);
  }

  // Within TTL (or a refresh already in flight) — serve current data.
  return cache.data;
}

/** Test-only: null the cache state so suites stay isolated. */
export function __resetLeaderboardCache(): void {
  cache.data = null;
  cache.fetchedAt = 0;
  cache.refreshing = false;
}
