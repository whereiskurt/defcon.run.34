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

/**
 * Map of a Route's `gpxFileId` value → its curated metadata.
 *
 * The `gpxFileId` an editor sets in the CMS may be EITHER a run.gpx `fileId`
 * OR a GPX filename — the manifest matches an overlay route against both, so
 * this works whether the editor started with filenames (quick) or migrated to
 * fileIds (durable). Nothing here assumes which.
 */
export async function fetchRouteMeta(): Promise<Map<string, RouteMeta>> {
  const out = new Map<string, RouteMeta>();
  if (!BASE_URL || !API_TOKEN) return out;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = new URL(`${BASE_URL}/api/routes`);
    url.searchParams.set("filters[gpxFileId][$notNull]", "true");
    const fields = [
      "gpxFileId", "name", "shortDescription", "description",
      "distance", "elevationGain", "mapColor", "mapWeight", "mapOpacity", "stravaUrl",
    ];
    fields.forEach((f, i) => url.searchParams.set(`fields[${i}]`, f));
    // coverImage is a media relation — populate its url + formats (sized variants).
    url.searchParams.set("populate[coverImage][fields][0]", "url");
    url.searchParams.set("populate[coverImage][fields][1]", "formats");
    url.searchParams.set("pagination[pageSize]", "200");
    url.searchParams.set("status", "published");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[run.gpx strapi] route meta fetch: HTTP ${res.status}`);
      return out;
    }

    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    for (const r of json.data ?? []) {
      const gpxFileId = r.gpxFileId as string | undefined;
      if (!gpxFileId) continue;
      const ci = r.coverImage as
        | { url?: string; formats?: Record<string, { url?: string }> }
        | null
        | undefined;
      const fmts = ci?.formats ?? {};
      out.set(gpxFileId, {
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
      });
    }
  } catch (err) {
    // CMS unconfigured / unreachable / slow → fall back to filenames + GPX meta.
    console.warn("[run.gpx strapi] route meta fetch failed:", err);
  } finally {
    clearTimeout(timer);
  }
  return out;
}
