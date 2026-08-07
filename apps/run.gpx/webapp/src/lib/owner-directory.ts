/**
 * Resolve run.gpx `userId`s to runner display names, for admin surfaces only.
 *
 * WHY IT IS A CROSS-SERVICE CALL. run.gpx stores no runner profile of its own —
 * `AuthProfile` lives in run.auth and `RunUser` in run.human. A `GpxFile.userId`
 * IS the OIDC subject (see `reconcileAccomplishments`, which passes it straight
 * through as `oidcSub`), so run.human's existing
 * `/api/internal/user/[oidcSub]?summary=1` is exactly the right lookup and
 * already exists. Nothing new is deployed on the run.human side.
 *
 * `?summary=1` is the LEAST-PRIVILEGE form of that endpoint — it returns only
 * `{ runUserId, displayName }`. The unsummarised form would hand back the
 * runner's email and their MQTT credentials, neither of which has any business
 * on a heat-map moderation page (Kurt, 2026-08-07: no email on this surface).
 *
 * BEST-EFFORT THROUGHOUT. Every failure mode — no secret configured, run.human
 * down, unknown sub — resolves to "no name" and leaves the caller showing the
 * raw userId, which is what the page showed before this existed. A moderation
 * roster that fails to load because a name lookup broke would be strictly worse
 * than one with unresolved ids.
 */

import { humanInternalUrl } from "@/lib/gpx-accomplishment";

export type OwnerSummary = { displayName?: string };

/** Concurrent lookups. Matches the S3 fan-out width used by the heat-map builder. */
const CHUNK_SIZE = 20;

/**
 * Process-level cache. The ECS service runs `desired_count 1` with autoscaling
 * off, so this is a real cache rather than a coin flip across replicas.
 *
 * A display name changes about once in a runner's lifetime, and a stale one on
 * an admin page costs nothing, so the TTL is generous — the point is that
 * reloading the roster while working through a moderation queue does not
 * re-hammer run.human (itself a single task) with a request per runner.
 */
const TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { at: number; owner: OwnerSummary }>();

/** Exported for tests — a process-level cache would otherwise leak across cases. */
export function clearOwnerCache(): void {
  cache.clear();
}

async function lookupOne(
  userId: string,
  secret: string,
  doFetch: typeof fetch
): Promise<OwnerSummary | null> {
  const res = await doFetch(
    humanInternalUrl(`/api/internal/user/${encodeURIComponent(userId)}?summary=1`),
    { headers: { "X-Internal-Secret": secret } }
  );
  // 404 is the ordinary answer for a runner who never signed into run.human —
  // not an error, just no name to show.
  if (!res.ok) return null;
  const body = (await res.json()) as { displayName?: string };
  return body?.displayName ? { displayName: body.displayName } : null;
}

/**
 * Resolve a de-duplicated list of userIds. Callers should pass distinct ids —
 * ~300 runs are typically ~60 runners, and the same profile fetched five times
 * is four wasted round-trips against a single-task service.
 */
export async function resolveOwners(
  userIds: string[],
  deps?: { fetchImpl?: typeof fetch; now?: () => number }
): Promise<Map<string, OwnerSummary>> {
  const doFetch = deps?.fetchImpl ?? fetch;
  const now = deps?.now ?? Date.now;
  const out = new Map<string, OwnerSummary>();

  const secret = process.env.AUTH_INTERNAL_SECRET;
  if (!secret) {
    // Not an error worth failing the page for: locally and in any environment
    // without the shared secret, the roster simply shows raw ids.
    console.warn("[owner-directory] AUTH_INTERNAL_SECRET unset — names unresolved");
    return out;
  }

  const misses: string[] = [];
  for (const userId of userIds) {
    const hit = cache.get(userId);
    if (hit && now() - hit.at < TTL_MS) {
      if (hit.owner.displayName) out.set(userId, hit.owner);
    } else {
      misses.push(userId);
    }
  }

  for (let i = 0; i < misses.length; i += CHUNK_SIZE) {
    const chunk = misses.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (userId) => {
        let owner: OwnerSummary | null = null;
        try {
          owner = await lookupOne(userId, secret, doFetch);
        } catch (e) {
          console.error(`[owner-directory] ${userId}:`, e);
          return; // transient — do NOT cache a failure as "no name"
        }
        // A definitive "no name" IS cached: without that, a roster full of
        // run.human-less runners would re-request every one on every load.
        if (cache.size >= CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(userId, { at: now(), owner: owner ?? {} });
        if (owner?.displayName) out.set(userId, owner);
      })
    );
  }

  return out;
}
