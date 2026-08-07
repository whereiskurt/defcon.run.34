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
 * In-flight loads, keyed by user — the single-flight guard (2026-08-06).
 *
 * WHY: this route was admin-gated until the drill opened to every signed-in
 * runner, so "many people expand the same row at once" went from impossible to
 * the expected traffic pattern (everyone checks the top ten). Without this,
 * each concurrent expansion of the same COLD row ran its own `loadDrill` — 5
 * DynamoDB queries — against a service running one task with autoscaling off.
 * With it, a herd on one row costs exactly one load.
 *
 * Mirrors `scan-cache.ts`'s `inflight` + `generation` pair, per-key.
 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Per-user bust counter. A load that was already in flight when a write landed
 * carries PRE-write rows, so it must not be committed to the cache — otherwise
 * `bustDrillCache` silently loses the race and read-your-writes breaks. Waiters
 * already holding that promise still receive its value (they would have either
 * way); only the COMMIT is dropped, so the next caller reloads.
 *
 * Bounded by the number of runners ever busted — a few hundred small ints.
 */
const generation = new Map<string, number>();

/**
 * Return the cached drill for `userId`, loading it via `loader` on a cold or
 * TTL-expired entry. Concurrent callers for the same user share ONE load. A
 * cache hit refreshes LRU recency (delete + re-set moves the key to the end of
 * Map iteration order) so eviction favors the least recently READ user, not
 * just the least recently loaded.
 */
export async function getCachedDrill<T>(
  userId: string,
  loader: () => Promise<T>
): Promise<T> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.fetchedAt < DRILL_CACHE_TTL_MS) {
    cache.delete(userId);
    cache.set(userId, hit);
    return hit.data as T;
  }

  // Someone is already loading this user — join them rather than pile on.
  const existing = inflight.get(userId);
  if (existing) return existing as Promise<T>;

  const gen = generation.get(userId) ?? 0;
  const load = loader()
    .then((data) => {
      // Dropped if a bust landed mid-flight (see `generation` above). A
      // rejected load commits nothing and is never cached, so the next caller
      // retries instead of inheriting the failure.
      if ((generation.get(userId) ?? 0) === gen) {
        cache.set(userId, { data, fetchedAt: Date.now() });
        if (cache.size > DRILL_CACHE_MAX) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
      }
      return data;
    })
    .finally(() => {
      // Only clear OUR entry: a bust may already have installed a newer load.
      if (inflight.get(userId) === load) inflight.delete(userId);
    });

  inflight.set(userId, load);
  return load;
}

/**
 * Force the next `getCachedDrill` call for this user to reload — including one
 * whose load is in flight right now (that result is dropped, not committed).
 */
export function bustDrillCache(userId: string): void {
  cache.delete(userId);
  generation.set(userId, (generation.get(userId) ?? 0) + 1);
  inflight.delete(userId);
}

/** Test-only: clear the cache so suites stay isolated. */
export function __resetDrillCache(): void {
  cache.clear();
  inflight.clear();
  generation.clear();
}
