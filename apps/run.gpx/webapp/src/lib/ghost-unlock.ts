/**
 * Goldstein unlock-seed fetcher — the map-popup CTF clue.
 *
 * Server-side proxy to run.human's internal ghost-unlock endpoint (same
 * plumbing as the rabbit proxy: RUN_HUMAN_INTERNAL_URL + x-internal-secret).
 * The derived seed is deterministic for a given server secret, so a successful
 * response is cached for the process lifetime. Fail-soft: any error → null and
 * the ghosts feed simply omits the seed properties.
 */
const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_HUMAN_PORT = process.env.LOCAL_HUMAN_PORT || "3001";

const RUN_HUMAN_URL =
  process.env.RUN_HUMAN_INTERNAL_URL ||
  (isDev
    ? `http://localhost:${LOCAL_HUMAN_PORT}`
    : `http://run-human.app-${region}-${siteDomain.replace(/\./g, "-")}.local:3000/${region}`);

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";

export type GhostUnlock = { secret: string; qr: string };

let cached: GhostUnlock | null = null;

/** Test hook — clears the process-lifetime cache. */
export function resetGhostUnlockCache() {
  cached = null;
}

export async function goldsteinUnlock(): Promise<GhostUnlock | null> {
  if (cached) return cached;
  try {
    const res = await fetch(
      `${RUN_HUMAN_URL}/api/internal/ghost-unlock?ghost=ghost.goldstein`,
      {
        cache: "no-store",
        headers: { "x-internal-secret": INTERNAL_SECRET },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<GhostUnlock>;
    if (
      typeof body.secret === "string" &&
      body.secret.length > 0 &&
      typeof body.qr === "string" &&
      body.qr.startsWith("data:image/")
    ) {
      cached = { secret: body.secret, qr: body.qr };
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}
