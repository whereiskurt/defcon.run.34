/**
 * Social-QR resolver for run.bib (Plan 34-02, Slice C backend — D-10 / C-T2).
 *
 * The bib tear-off QR should encode the runner's REAL per-user social-QR value
 * (run.human profile "Show My QR"): `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>`.
 *
 * That `hash` is a SHA256 QR-lookup value stored only on run.human's RunUser and
 * is NOT derivable from session claims (recomputing it needs run.human-only `seed`),
 * so run.bib must fetch it. We mirror `quota-client.ts`'s internal-URL derivation +
 * `X-Internal-Secret` server-to-server pattern, but target run.human's internal user
 * endpoint (run.human mounts its app at basePath `/{region}` in production).
 *
 * Security / resilience:
 *   - The internal secret is read server-side only and sent as a header (never logged).
 *   - The service-discovery host is fixed (no user-controlled URL → no SSRF).
 *   - getSocialQrHash catches ALL errors and returns null: a QR miss/timeout must
 *     never 500 the orderform — it falls back to the runner-code QR (T-34-07).
 */

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_HUMAN_PORT = process.env.LOCAL_HUMAN_PORT || "3001";

// run.human internal base URL (via service discovery), mirroring the quota-client
// pattern for run.auth. In production run.human has basePath=/{region}, so include
// it in the URL. HUMAN_INTERNAL_URL overrides the whole base when set.
const HUMAN_BASE_URL =
  process.env.HUMAN_INTERNAL_URL ||
  (isDev
    ? `http://localhost:${LOCAL_HUMAN_PORT}`
    : `http://run-human.app-${region}-${siteDomain.replace(
        /\./g,
        "-"
      )}.local:3000/${region}`);

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";

/**
 * Resolve a runner's social-QR `hash` from run.human's internal user endpoint.
 *
 * Returns the hash string when the endpoint provides one, else null. Any failure
 * (network reject, non-2xx, missing/blank hash) resolves to null and never throws,
 * so the orderform can fall back to the runner-code QR without a 500.
 */
export async function getSocialQrHash(
  ownerSub: string
): Promise<string | null> {
  try {
    const url = `${HUMAN_BASE_URL}/api/internal/user/${encodeURIComponent(
      ownerSub
    )}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as { hash?: unknown };
    return typeof json.hash === "string" && json.hash ? json.hash : null;
  } catch {
    // A QR miss must never break the orderform — fall back to the runner code.
    return null;
  }
}

/**
 * Build the runner's social-QR target URL from run.bib's own env.
 *
 * Mirrors run.human's `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>` shape
 * (defaults `defcon.run` / `use1`). Read at call time so env overrides apply.
 */
export function buildSocialQrUrl(hash: string): string {
  const domain = process.env.SITE_DOMAIN || "defcon.run";
  const regionShort = process.env.REGION_SHORT || "use1";
  // IN-04: encode the hash query param (a hex SHA256 encodes to itself today,
  // but this is defense-in-depth against any future non-URL-safe hash format),
  // matching how getSocialQrHash already encodeURIComponent's ownerSub.
  return `https://run.${domain}/${regionShort}/r?h=${encodeURIComponent(hash)}`;
}
