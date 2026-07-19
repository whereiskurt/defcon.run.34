import { NextResponse } from "next/server";
import { ghostFeatureCollection, type NodeDb } from "@/lib/mesh-nodes";

/**
 * GET /api/gpx/public/ghosts — the "ghost proxy" (trust boundary).
 * Server-side fetches meshtk's INTERNAL nodes.json, filters to ghost/contest/
 * operative nodes, and emits a ready GeoJSON FeatureCollection carrying only a
 * persona dossier + an allowlisted radio subset (model/role/region/preset/fw/
 * battery — same as the rabbit feed; never keys or private telemetry). Hidden
 * ghost-mode layer polls this. Fail-soft: any error → [].
 */
const GHOST_FEED_URL = process.env.GHOST_FEED_URL || "http://localhost:3005/nodes.json";
const CACHE_SECONDS = 60;
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
    const res = await fetch(GHOST_FEED_URL, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return json(EMPTY);
    const db = (await res.json()) as NodeDb;
    return json(ghostFeatureCollection(db));
  } catch (error) {
    console.error("ghost proxy error:", error);
    return json(EMPTY);
  }
}
