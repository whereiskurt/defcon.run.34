/**
 * Per-user drill cache (Task 3) — a simple TTL+LRU in-memory cache, module-level
 * singleton (one per Node process/lambda warm container, same lifetime as
 * `leaderboard-cache.ts`).
 *
 * Deliberately NOT stale-while-revalidate like `leaderboard-cache.ts`'s
 * full-table scan cache: a drill is a small per-user computation, so blocking
 * one request per user per minute (cold or past-TTL) is fine — no background
 * refresh, no staleness window.
 *
 * `bustDrillCache` lets the reconcile route (and any other rollup mutator)
 * force a fresh drill for a specific user right after it changes that user's
 * accomplishments, instead of waiting out the TTL.
 */

export const DRILL_CACHE_TTL_MS = 60_000;
export const DRILL_CACHE_MAX = 500;

type CacheEntry = { data: unknown; fetchedAt: number };

const cache = new Map<string, CacheEntry>();

/**
 * Return the cached drill for `userId`, loading it via `loader` on a cold or
 * TTL-expired entry. A cache hit refreshes LRU recency (delete + re-set moves
 * the key to the end of Map iteration order) so eviction favors the least
 * recently READ user, not just the least recently loaded.
 */
export async function getCachedDrill<T>(
  userId: string,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.fetchedAt < DRILL_CACHE_TTL_MS) {
    cache.delete(userId);
    cache.set(userId, hit);
    return hit.data as T;
  }

  const data = await loader();
  cache.set(userId, { data, fetchedAt: now });
  if (cache.size > DRILL_CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  return data;
}

/** Force the next `getCachedDrill` call for this user to reload. */
export function bustDrillCache(userId: string): void {
  cache.delete(userId);
}

/** Test-only: clear the cache so suites stay isolated. */
export function __resetDrillCache(): void {
  cache.clear();
}
