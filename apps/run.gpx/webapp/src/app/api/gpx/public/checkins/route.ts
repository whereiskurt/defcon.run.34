import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/gpx/public/checkins - Public, UNAUTHENTICATED proxy for run.human's
 * public check-ins feed (`/api/checkins/public`, isPrivate === false only).
 *
 * The studio is served from gpx.defcon.run, so this keeps the "User Check-ins"
 * overlay same-origin — the same cross-service pattern as the Strava sync and
 * CMS title enrichment (server-side fetch over ECS service discovery).
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

const CACHE_SECONDS = 120;

export async function GET(req: NextRequest) {
  try {
    // Optional time window (v1.8 Phase 4) — forwarded verbatim when numeric;
    // each distinct value is its own CDN cache entry.
    const sinceParam = req.nextUrl.searchParams.get("since");
    const since =
      sinceParam && Number.isFinite(Number(sinceParam))
        ? `?since=${Number(sinceParam)}`
        : "";
    const res = await fetch(`${RUN_HUMAN_URL}/api/checkins/public${since}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch public check-ins" },
        { status: 502 }
      );
    }
    const body = await res.json();

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
      },
    });
  } catch (error) {
    console.error("Error proxying public check-ins:", error);
    return NextResponse.json(
      { error: "Failed to fetch public check-ins" },
      { status: 502 }
    );
  }
}
