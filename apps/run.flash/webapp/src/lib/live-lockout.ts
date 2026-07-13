import type { fetchFreshClaims } from "@/config/auth";

/**
 * Live lock-out check at the MUTATION boundary.
 *
 * Read access can ride the warm JWT session (re-validated on run.flash's ~5-min
 * REFRESH_INTERVAL — a few minutes of stale read access is low-risk). But WRITES
 * should not: a locked/abusive identity must be stopped from changing anything
 * the moment they're locked. Every mutating (POST/PUT/PATCH/DELETE) handler calls
 * `assertNotLockedLive(authUserId)` and 403s if it returns true.
 *
 * Backed by run.auth's `/api/session/validate/user/[id]` (via fetchFreshClaims),
 * with a short per-identity cache so a burst of writes doesn't hammer run.auth
 * (which runs on a small task). FAIL-OPEN: a lookup error returns "not locked" so
 * a run.auth/DynamoDB hiccup can't freeze all writes — the 5-min session check is
 * the backstop.
 */

const CACHE_TTL_MS = 15_000; // ~15s: writes blocked within this of a lock; bounds run.auth load
type Entry = { locked: boolean; at: number };
const cache = new Map<string, Entry>();

/** Test seam: clear the per-process cache. */
export function __resetLiveLockoutCache() {
  cache.clear();
}

/**
 * @param authUserId the run.auth sub (session.user.id), NOT a run.human id.
 * @param now injectable clock for tests.
 * @param fetcher injectable claims fetch for tests.
 * @returns true if the identity is currently locked out (caller should 403).
 */
export async function assertNotLockedLive(
  authUserId: string | undefined | null,
  now: number = Date.now(),
  fetcher?: typeof fetchFreshClaims,
): Promise<boolean> {
  if (!authUserId) return false; // no run.auth identity → let the route's own auth decide

  const hit = cache.get(authUserId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.locked;

  // Lazily pull fetchFreshClaims only when not injected, so tests (which inject a
  // fake) don't transitively load the heavy NextAuth config.
  const doFetch = fetcher ?? (async (id: string) => (await import("@/config/auth")).fetchFreshClaims(id));
  const claims = await doFetch(authUserId); // null on any error → fail-open
  if (claims === null) return false; // don't cache a failed lookup; retry next write
  const locked = claims.lockedOut === true;
  cache.set(authUserId, { locked, at: now });
  return locked;
}
