import { NextResponse } from "next/server";
import { shuttleFeatureCollection } from "@/lib/bsides-shuttles";

/**
 * GET /api/gpx/public/shuttles — the B-Sides shuttle proxy (trust boundary).
 *
 * Fetches the B-Sides Las Vegas fleet's GPS-vendor export and re-emits it as a
 * GeoJSON FeatureCollection carrying only position and light status. The vendor's
 * device serials, battery, cell/GPS signal, tamper flags and street addresses are
 * dropped in `@/lib/bsides-shuttles` and never reach a browser.
 *
 * This proxy is not optional. The upstream sends no `Access-Control-Allow-Origin`
 * (verified with an explicit Origin request header and an OPTIONS preflight), so
 * a browser cannot read the feed directly — and even if it could, we would not
 * want to republish another organization's device telemetry.
 *
 * Fail-soft: on timeout, upstream error, or an unparseable body we serve the last
 * good response if it is still warm, otherwise an empty collection. This route
 * never returns 5xx — the map treats an empty layer as quiet and an error as
 * broken, and quiet is the truthful state when the fleet's tracker is down.
 */

/**
 * The vendor URL is expected to change: `action=shareinit` sets an ASP.NET
 * session cookie, which implies a paired update endpoint we will be handed
 * later. Keeping it in the environment makes that swap a task-definition change
 * rather than a code change and a release.
 */
const FEED_URL =
  process.env.BSIDES_SHUTTLE_FEED_URL ||
  "https://portal.gps-tracking.com/geojson.aspx?action=shareinit&sid=175300";

const CACHE_SECONDS = 30;
const UPSTREAM_TIMEOUT_MS = 3000;
/** How long a cached payload may still be served after an upstream failure. */
const STALE_SERVE_MS = 5 * 60 * 1000;

const EMPTY = { type: "FeatureCollection", features: [] as GeoJSON.Feature[] };

/**
 * Module-scoped cache. CloudFront has caching disabled on `/{region}/*`, so the
 * `s-maxage` header below is decorative and this is the real cache: it holds
 * upstream traffic to one request per task per interval no matter how many
 * people have the map open.
 */
let cached: { at: number; body: GeoJSON.FeatureCollection } | null = null;

function json(fc: unknown) {
  return NextResponse.json(fc, {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
    },
  });
}

/** Last good payload if it is still worth showing, else an empty collection. */
function fallback(now: number) {
  if (cached && now - cached.at <= STALE_SERVE_MS) return json(cached.body);
  return json(EMPTY);
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_SECONDS * 1000) return json(cached.body);

  try {
    const res = await fetch(FEED_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { accept: "application/json,text/plain,*/*" },
    });
    if (!res.ok) {
      console.error("shuttle proxy: upstream returned", res.status);
      return fallback(now);
    }
    // Upstream answers `content-type: text/plain`, so `res.json()` is not safe
    // to rely on — read the text and parse it ourselves.
    const body = shuttleFeatureCollection(JSON.parse(await res.text()));
    cached = { at: now, body };
    return json(body);
  } catch (error) {
    console.error("shuttle proxy error:", error);
    return fallback(now);
  }
}
