/**
 * Minimal read-only Strapi client for run.gpx (Kurt 2026-07-04).
 *
 * Fetches CMS `Route` metadata so public overlay routes can show a curated name,
 * a rich-text description, distance/elevation, and line styling instead of just
 * the GPX filename. Best-effort: on any failure (unconfigured, unreachable, slow,
 * non-200) it returns an empty map and the caller falls back to filename +
 * GPX-derived metadata — the overlays must never break because the CMS is down.
 *
 * Mirrors run.human's client: Bearer internal token, no client-side cache. The
 * caching lives at the manifest response's `s-maxage` header (CDN/edge), so this
 * is only hit ~once per cache window per region.
 */
const BASE_URL =
  process.env.CMS_INTERNAL_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:1337" : "");
const API_TOKEN = process.env.STRAPI_API_TOKEN || "";

/** Curated CMS metadata for one overlay route, keyed by `gpxFileId`. All optional. */
export interface RouteMeta {
  title?: string; // Route.name
  shortDescription?: string; // plain-text one-liner (hover tooltip)
  descriptionHtml?: string; // Route.description (blocks) rendered to safe HTML
  distanceKm?: number; // Route.distance (curated, km)
  elevationM?: number; // Route.elevationGain (curated, m)
  mapColor?: string; // line color
  mapWeight?: number; // line width (1–10)
  mapOpacity?: number; // line opacity (0–1)
  coverImageUrl?: string; // full-size cover image (click-through target)
  coverImageDisplayUrl?: string; // sized-down variant for the popup
  stravaUrl?: string; // link to the route on Strava
}

/**
 * A single CMS point-of-interest attached to a route.
 *
 * PHASE-3 SEAM: declared here as the extension point for the POI work, but NOT
 * populated in Phase 2 — `CmsRouteData.pois` is always `[]` for now. The
 * `poiType`/`markerImageUrl`/`photoUrl`/`sortOrder` fields are intentionally
 * present so Phase 3 can fill them without touching this contract.
 */
export interface PoiMeta {
  name: string;
  description?: string;
  lat: number;
  lon: number;
  poiType?: string;
  markerImageUrl?: string; // CMS media (cms.defcon.run)
  photoUrl?: string; // CMS media
  sortOrder?: number;
}

/**
 * One CMS-native route as returned to the manifest. Carries the route's GPX
 * asset (when present) and its placement metadata (`mapFolder`/`sortOrder`)
 * alongside the existing `RouteMeta` enrichment. `pois` is the Phase-3 seam and
 * is always empty in Phase 2.
 */
export interface CmsRouteData {
  documentId: string;
  gpxFileId?: string;
  gpxUrl?: string;
  gpxName?: string;
  mapFolder: string;
  sortOrder?: number;
  meta: RouteMeta;
  pois: PoiMeta[];
}

// ---- Strapi "blocks" → safe HTML -------------------------------------------
// Route.description is a Strapi v5 blocks field (structured JSON). We render it
// server-side to a small whitelist of tags. Content is authored by trusted CMS
// admins, but we still escape every text node and href so a stray value can't
// inject markup.

type BlockNode = {
  type: string;
  level?: number;
  format?: string;
  url?: string;
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  children?: BlockNode[];
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function renderInline(nodes: BlockNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "link") {
        return `<a href="${esc(n.url || "")}" target="_blank" rel="noopener noreferrer">${renderInline(n.children)}</a>`;
      }
      let t = esc(n.text ?? "");
      if (!t) return "";
      if (n.code) t = `<code>${t}</code>`;
      if (n.bold) t = `<strong>${t}</strong>`;
      if (n.italic) t = `<em>${t}</em>`;
      if (n.underline) t = `<u>${t}</u>`;
      if (n.strikethrough) t = `<s>${t}</s>`;
      return t;
    })
    .join("");
}

function renderBlocks(blocks: BlockNode[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading": {
          const lvl = Math.min(Math.max(b.level ?? 2, 1), 6);
          return `<h${lvl}>${renderInline(b.children)}</h${lvl}>`;
        }
        case "list": {
          const tag = b.format === "ordered" ? "ol" : "ul";
          const items = (b.children ?? [])
            .map((li) => `<li>${renderInline(li.children)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "quote":
          return `<blockquote>${renderInline(b.children)}</blockquote>`;
        case "code":
          return `<pre><code>${esc((b.children ?? []).map((c) => c.text ?? "").join("\n"))}</code></pre>`;
        case "paragraph":
        default: {
          const inner = renderInline(b.children);
          return inner ? `<p>${inner}</p>` : "";
        }
      }
    })
    .join("");
}

export function blocksToHtml(blocks: unknown): string | undefined {
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  const html = renderBlocks(blocks as BlockNode[]).trim();
  return html || undefined;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Default group a standalone CMS route joins when it names no `mapFolder`. */
const DEFAULT_MAP_FOLDER = "DEF CON 34 Maps";

/**
 * Fetch CMS `Route` rows for the public manifest, in two parts:
 *
 * - `byGpxKey` — the existing enrichment join: a `Map<gpxFileId, RouteMeta>`.
 *   The `gpxFileId` an editor sets in the CMS may be EITHER a run.gpx `fileId`
 *   OR a GPX filename — the manifest matches an overlay route against both, so
 *   this works whether the editor started with filenames (quick) or migrated to
 *   fileIds (durable). Only rows that HAVE a `gpxFileId` land here, and the
 *   value is byte-for-byte the same `RouteMeta` the old single-map return built.
 * - `cmsRoutes` — every published route (with a `gpxFileId` OR a `gpxFiles`
 *   asset), carrying its GPX asset URL/name, `mapFolder`/`sortOrder` placement,
 *   the same `RouteMeta` under `meta`, and an (always-empty in Phase 2) `pois`
 *   seam. This drives standalone-route emission in the manifest.
 *
 * Best-effort: on any failure (unconfigured, unreachable, slow, non-200) it
 * returns `{ byGpxKey: empty map, cmsRoutes: [] }` and the manifest degrades to
 * DynamoDB-only — the overlays must never break because the CMS is down.
 */
export async function fetchRouteMeta(): Promise<{
  byGpxKey: Map<string, RouteMeta>;
  cmsRoutes: CmsRouteData[];
}> {
  const byGpxKey = new Map<string, RouteMeta>();
  const cmsRoutes: CmsRouteData[] = [];
  if (!BASE_URL || !API_TOKEN) return { byGpxKey, cmsRoutes };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = new URL(`${BASE_URL}/api/routes`);
    // Widen the filter: include CMS-native routes that have a GPX asset but no
    // gpxFileId. $or of two branches — gpxFileId notNull OR gpxFiles notNull.
    url.searchParams.set("filters[$or][0][gpxFileId][$notNull]", "true");
    url.searchParams.set("filters[$or][1][gpxFiles][$notNull]", "true");
    const fields = [
      "gpxFileId", "name", "shortDescription", "description",
      "distance", "elevationGain", "mapColor", "mapWeight", "mapOpacity", "stravaUrl",
      "mapFolder", "sortOrder",
    ];
    fields.forEach((f, i) => url.searchParams.set(`fields[${i}]`, f));
    // coverImage is a media relation — populate its url + formats (sized variants).
    url.searchParams.set("populate[coverImage][fields][0]", "url");
    url.searchParams.set("populate[coverImage][fields][1]", "formats");
    // gpxFiles is the route's GPX asset (first entry) — we need its url + name.
    url.searchParams.set("populate[gpxFiles][fields][0]", "url");
    url.searchParams.set("populate[gpxFiles][fields][1]", "name");
    // NOTE: pointsOfInterest is intentionally NOT populated — POIs are Phase 3.
    url.searchParams.set("pagination[pageSize]", "200");
    url.searchParams.set("status", "published");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[run.gpx strapi] route meta fetch: HTTP ${res.status}`);
      return { byGpxKey, cmsRoutes };
    }

    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    for (const r of json.data ?? []) {
      const gpxFileId = (r.gpxFileId as string) || undefined;
      const ci = r.coverImage as
        | { url?: string; formats?: Record<string, { url?: string }> }
        | null
        | undefined;
      const fmts = ci?.formats ?? {};
      const meta: RouteMeta = {
        title: (r.name as string) || undefined,
        shortDescription: (r.shortDescription as string) || undefined,
        descriptionHtml: blocksToHtml(r.description),
        distanceKm: num(r.distance),
        elevationM: num(r.elevationGain),
        mapColor: (r.mapColor as string) || undefined,
        mapWeight: num(r.mapWeight),
        mapOpacity: num(r.mapOpacity),
        coverImageUrl: ci?.url || undefined,
        coverImageDisplayUrl:
          fmts.small?.url || fmts.medium?.url || fmts.thumbnail?.url || ci?.url || undefined,
        stravaUrl: (r.stravaUrl as string) || undefined,
      };

      // First gpxFiles asset is the route's GPX (url + name), if any.
      const gpxFiles = r.gpxFiles as
        | Array<{ url?: string; name?: string }>
        | null
        | undefined;
      const gpx = Array.isArray(gpxFiles) ? gpxFiles[0] : undefined;

      cmsRoutes.push({
        documentId: r.documentId as string,
        gpxFileId,
        gpxUrl: gpx?.url || undefined,
        gpxName: gpx?.name || undefined,
        mapFolder: ((r.mapFolder as string) || "").trim() || DEFAULT_MAP_FOLDER,
        sortOrder: num(r.sortOrder),
        meta,
        pois: [], // Phase-3 seam — POIs are not populated in Phase 2.
      });

      // Preserve the enrichment join: only rows with a gpxFileId enrich a
      // DynamoDB route (value identical to the old single-map return).
      if (gpxFileId) byGpxKey.set(gpxFileId, meta);
    }
  } catch (err) {
    // CMS unconfigured / unreachable / slow → fall back to filenames + GPX meta.
    console.warn("[run.gpx strapi] route meta fetch failed:", err);
    return { byGpxKey: new Map(), cmsRoutes: [] };
  } finally {
    clearTimeout(timer);
  }
  return { byGpxKey, cmsRoutes };
}
