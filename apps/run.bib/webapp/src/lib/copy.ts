/**
 * copy.ts — the SERVER-ONLY run.bib copy resolver (Phase 36-01).
 *
 * SERVER-ONLY BY CONTRACT: this module reads STRAPI_API_TOKEN + CMS_INTERNAL_URL
 * and MUST NOT enter the client bundle. It is imported only from server
 * components / server code; Plan 03's client provider receives ONLY the resolved
 * copy map (never this module). We do not `import 'server-only'` because Next 16
 * vendors that package internally (next/dist/compiled/server-only) rather than
 * exposing a top-level `server-only` module, so a literal import breaks both
 * `tsc --noEmit` and vitest; the contract is enforced by convention here — the
 * same convention the other bib server libs use (social-qr.ts, ssm.ts, stripe.ts).
 * The token is never read via NEXT_PUBLIC_* and never crosses to the client.
 *
 * loadCopy(locale) fetches the `ui-string` catalog once through the Next.js Data
 * Cache and returns a single already-merged map. resolveCopy is the un-cached test
 * seam behind it. Fallback order (each layer caught independently — NEVER throws):
 *   1. Strapi `ui-string` API  (cached, ~2.5s AbortController)   — wins
 *   2. S3 export copy.json      (cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json)
 *   3. committed copy-snapshot.json (zero-network static import) — floor
 * unstable_cache wraps resolveCopy so the RETURNED map (including any fallback
 * outcome) is cached: at most one slow/failed Strapi call per revalidate window
 * (SC-3 / FALL-02), making the fallback as cheap as the happy path.
 */

import { unstable_cache } from "next/cache";
import type { CopyMap } from "./copy-core";
import { interpolate, t } from "./copy-core";
import snapshot from "./copy-snapshot.json";

export type { CopyMap };
export { interpolate, t };

const REVALIDATE_SECONDS = 300;
const STRAPI_TIMEOUT_MS = 2500;
const S3_TIMEOUT_MS = 2500;

/** Committed offline floor for the requested locale (zero network). */
function snapshotMap(locale: string): CopyMap {
  const bundle = snapshot as Record<string, CopyMap>;
  return { ...(bundle[locale] ?? {}) };
}

/** Strapi `ui-string` catalog for the locale — {} on any error/timeout/miss. */
async function fetchStrapi(locale: string): Promise<CopyMap> {
  const baseUrl = process.env.CMS_INTERNAL_URL;
  const token = process.env.STRAPI_API_TOKEN;
  // No CMS wiring yet (run.bib had no CMS client before this) → skip cleanly.
  if (!baseUrl || !token) return {};

  try {
    const url = new URL(`${baseUrl}/api/ui-strings`);
    url.searchParams.set("filters[locale][$eq]", locale);
    url.searchParams.set("pagination[pageSize]", "1000");

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(STRAPI_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS, tags: ["copy"] },
    });
    if (!res.ok) return {};

    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    const map: CopyMap = {};
    for (const row of rows) {
      // Strapi 5 flattens attributes onto the row; tolerate the v4 shape too.
      const attrs = row?.attributes ?? row;
      if (attrs?.key) map[attrs.key] = attrs.value ?? "";
    }
    return map;
  } catch {
    // Slow/hung/unreachable Strapi must never break a render (T-36-02).
    return {};
  }
}

/** S3 public copy.json export for the locale — {} on any error/miss. */
async function fetchS3(locale: string): Promise<CopyMap> {
  const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
  const regionShort = process.env.REGION_SHORT || "use1";
  try {
    const url = `https://cms.${siteDomain}/${regionShort}/cms/copy.json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(S3_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS, tags: ["copy"] },
    });
    if (!res.ok) return {};
    const json = await res.json();
    const localeMap = json?.[locale];
    return localeMap && typeof localeMap === "object" ? (localeMap as CopyMap) : {};
  } catch {
    // Garbage/unreachable S3 falls through to the snapshot floor (T-36-03/04).
    return {};
  }
}

/**
 * resolveCopy — un-cached test seam. Resolves each layer independently, catches
 * every failure, and merges bottom-up (snapshot base, then S3, then Strapi on
 * top) into one flat locale map. NEVER throws; always returns an object.
 */
export async function resolveCopy(locale = "default"): Promise<CopyMap> {
  const [strapi, s3] = await Promise.all([
    fetchStrapi(locale),
    fetchS3(locale),
  ]);
  return { ...snapshotMap(locale), ...s3, ...strapi };
}

/**
 * loadCopy — the cached entrypoint every server caller uses. The resolved map
 * (including the fallback outcome) is what gets cached, so the fallback is as
 * fast as the happy path: one slow/failed Strapi call per revalidate window max.
 */
export function loadCopy(locale = "default"): Promise<CopyMap> {
  return unstable_cache(
    (loc: string) => resolveCopy(loc),
    ["copy", locale],
    { revalidate: REVALIDATE_SECONDS, tags: ["copy"] }
  )(locale);
}
