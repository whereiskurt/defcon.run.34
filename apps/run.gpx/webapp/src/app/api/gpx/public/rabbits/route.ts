import { NextResponse } from "next/server";
import { rabbitFeatureCollection, type NodeDb, type MeshMapEntry } from "@/lib/mesh-nodes";

/**
 * GET /api/gpx/public/rabbits — the "rabbit proxy" (trust boundary).
 * Intersects meshtk's INTERNAL nodes.json with run.human's internal opted-in
 * mesh-map feed and emits a ready GeoJSON FeatureCollection with only public
 * identity fields. Only verified && showOnMap users appear. Fail-soft → [].
 */
const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_HUMAN_PORT = process.env.LOCAL_HUMAN_PORT || "3001";

// Internal run.human URL via service discovery (container-to-container).
// In production run.human has basePath=/{region}, so include it in the URL.
const RUN_HUMAN_URL =
  process.env.RUN_HUMAN_INTERNAL_URL ||
  (isDev
    ? `http://localhost:${LOCAL_HUMAN_PORT}`
    : `http://run-human.app-${region}-${siteDomain.replace(/\./g, "-")}.local:3000/${region}`);

const GHOST_FEED_URL = process.env.GHOST_FEED_URL || "http://localhost:3005/nodes.json";
const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";
const CACHE_SECONDS = 30;
const EMPTY = { type: "FeatureCollection", features: [] as GeoJSON.Feature[] };

function json(fc: unknown) {
  return NextResponse.json(fc, {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
    },
  });
}

export async function GET() {
  try {
    const [nodesRes, mapRes] = await Promise.all([
      fetch(GHOST_FEED_URL, { cache: "no-store", signal: AbortSignal.timeout(3000) }),
      fetch(`${RUN_HUMAN_URL}/api/internal/mesh-map`, {
        cache: "no-store",
        headers: { "x-internal-secret": INTERNAL_SECRET },
        signal: AbortSignal.timeout(3000),
      }),
    ]);
    if (!nodesRes.ok || !mapRes.ok) return json(EMPTY);
    const db = (await nodesRes.json()) as NodeDb;
    const { entries } = (await mapRes.json()) as { entries: MeshMapEntry[] };
    return json(rabbitFeatureCollection(db, entries ?? []));
  } catch (error) {
    console.error("rabbit proxy error:", error);
    return json(EMPTY);
  }
}
