/**
 * Generic stale-while-revalidate cache for full-table DynamoDB entity scans.
 * SERVER-ONLY (holds process-lifetime state; never import into a client component).
 *
 * Generalized from the leaderboard's `getCachedScan` (LDBR-07) so other hot
 * paths can bound their own scans without re-implementing the policy or sharing
 * the leaderboard's singleton. Two deliberate differences from that original:
 *
 *   1. Each instance OWNS its scanner (bound at construction). `getCachedScan`
 *      takes the scanner per call, so handing one cache two different scanners
 *      silently serves whichever populated first — a footgun this shape removes.
 *   2. The COLD path is single-flight. `getCachedScan` only guards the
 *      background refresh, so N concurrent callers arriving at an empty cache
 *      each start their own scan. That is precisely the thundering herd we are
 *      trying to prevent: on an ECS rolling replace mid-event, every map viewer
 *      lands on a cold container at once.
 *
 * Policy:
 *   - cold (no rows yet) → ONE shared scan; all concurrent callers await it;
 *   - within TTL         → serves cached rows, no re-scan;
 *   - past TTL           → serves STALE rows synchronously and fires a single
 *                          non-awaited background refresh;
 *   - invalidate()       → drops the rows so the NEXT read re-scans and blocks.
 *                          For write paths that must be read-your-writes.
 *
 * A failed background refresh is logged and swallowed — it must never reject a
 * request that was already served stale rows. A failed COLD scan does reject
 * (there is nothing to serve), and clears the in-flight slot so the next request
 * retries rather than latching the failure.
 */

/** Matches LEADERBOARD_CACHE_TTL_MS — one number to reason about across caches. */
export const DEFAULT_SCAN_CACHE_TTL_MS = 60_000;

export type ScanCache<T> = {
  /** Cached rows, refreshed per the stale-while-revalidate policy above. */
  get: () => Promise<T[]>;
  /** Drop the rows so the next `get()` re-scans. Call from write paths. */
  invalidate: () => void;
};

export function createScanCache<T>(
  label: string,
  scan: () => Promise<T[]>,
  ttlMs: number = DEFAULT_SCAN_CACHE_TTL_MS
): ScanCache<T> {
  let data: T[] | null = null;
  let fetchedAt = 0;
  let refreshing = false;
  let inflight: Promise<T[]> | null = null;
  // Bumped by invalidate(). A scan that was already in flight when a write
  // landed carries pre-write rows, so it must NOT be committed to the cache —
  // otherwise invalidate() silently loses the race and read-your-writes breaks.
  let generation = 0;

  function refreshInBackground(): void {
    if (refreshing) return;
    refreshing = true;
    const gen = generation;
    void Promise.resolve()
      .then(scan)
      .then((rows) => {
        if (gen !== generation) return; // invalidated mid-flight — drop it.
        data = rows;
        fetchedAt = Date.now();
      })
      .catch((err) => {
        console.error(`[scan-cache:${label}] background refresh failed:`, err);
      })
      .finally(() => {
        refreshing = false;
      });
  }

  return {
    async get(): Promise<T[]> {
      if (data !== null) {
        // Strictly past the TTL — serve stale, kick a single background refresh.
        // (`>` not `>=`, matching the leaderboard cache: still fresh AT the TTL.)
        if (Date.now() - fetchedAt > ttlMs) refreshInBackground();
        return data;
      }

      // Cold — the only path that blocks, and it blocks exactly once no matter
      // how many callers arrive together.
      if (!inflight) {
        const gen = generation;
        inflight = scan()
          .then((rows) => {
            if (gen === generation) {
              data = rows;
              fetchedAt = Date.now();
            }
            return rows;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },

    invalidate(): void {
      generation += 1;
      data = null;
      fetchedAt = 0;
    },
  };
}
