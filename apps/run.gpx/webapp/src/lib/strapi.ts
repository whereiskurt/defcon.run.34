/**
 * Minimal read-only Strapi client for run.gpx (Kurt 2026-07-04).
 *
 * Fetches CMS `Route` titles so public overlay routes can show a curated name
 * instead of the GPX filename. Best-effort: on any failure (unconfigured,
 * unreachable, slow, non-200) it returns an empty map and the caller falls back
 * to the filename — the overlays must never break because the CMS is down.
 *
 * Mirrors run.human's client: Bearer internal token, no client-side cache. The
 * caching lives at the manifest response's `s-maxage` header (CDN/edge), so this
 * is only hit ~once per cache window per region.
 */
const BASE_URL =
  process.env.CMS_INTERNAL_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:1337" : "");
const API_TOKEN = process.env.STRAPI_API_TOKEN || "";

/**
 * Map of a Route's `gpxFileId` value → its display name (title).
 *
 * The `gpxFileId` an editor sets in the CMS may be EITHER a run.gpx `fileId`
 * OR a GPX filename — the manifest matches an overlay route against both, so
 * titles work whether the editor started with filenames (quick) or migrated to
 * fileIds (durable). Nothing here assumes which.
 */
export async function fetchRouteTitles(): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (!BASE_URL || !API_TOKEN) return titles;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = new URL(`${BASE_URL}/api/routes`);
    url.searchParams.set("filters[gpxFileId][$notNull]", "true");
    url.searchParams.set("fields[0]", "gpxFileId");
    url.searchParams.set("fields[1]", "name");
    url.searchParams.set("pagination[pageSize]", "200");
    url.searchParams.set("status", "published");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return titles;

    const json = (await res.json()) as {
      data?: Array<{ gpxFileId?: string | null; name?: string | null }>;
    };
    for (const r of json.data ?? []) {
      if (r.gpxFileId && r.name) titles.set(r.gpxFileId, r.name);
    }
  } catch {
    // CMS unconfigured / unreachable / slow → fall back to filenames.
  } finally {
    clearTimeout(timer);
  }
  return titles;
}
