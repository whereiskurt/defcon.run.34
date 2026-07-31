import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/s3-client";
import {
  isHeatmapYear,
  heatmapArtifactKey,
  type HeatmapArtifact,
} from "@/lib/heatmap-artifact";

/**
 * GET /api/gpx/public/heatmap/[year] — the SECOND public, UNAUTHENTICATED,
 * NON-ATTRIBUTABLE surface in this app (Phase 71, HEAT-01; implements D-09).
 * The first is `/api/gpx/public/aggregate`; see its module comment for how the
 * two relate and why the older "only public surface" claim no longer holds.
 *
 * Unlike the aggregate route, this one serves a PRECOMPUTED S3 artifact instead
 * of scanning DynamoDB per request — exactly the migration the aggregate
 * route's own NOTE recommends. The builder (`lib/heatmap-build.ts` for DC34,
 * the one-off backfill for DC33) writes the object; this route only reads it.
 *
 * Every feature in that object is BARE GEOMETRY with zero properties — no
 * name, no id, no user, no timestamp — produced and then structurally verified
 * upstream by `assertNonAttributable()` in `lib/heatmap-artifact.ts`, which is
 * the compensating control for sourcing runs without an owner opt-in gate.
 *
 * `?meta=1` projects the artifact's `meta` block alone (a few hundred bytes) so
 * the studio can render availability and the "last calculated" stamp without
 * paying for geometry it may never show. Each distinct query value is its own
 * CDN cache entry, the same convention `public/checkins/route.ts` relies on.
 *
 * There is deliberately no session lookup and no cookie read here — that
 * absence is the whole of what makes this route public, and it is also why a
 * shared CDN entry cannot leak per-user variation.
 */

// Longer than the aggregate route's 600: that route recomputes on demand, this
// one hands back an object that is rebuilt at most hourly, so a staler edge
// copy costs nothing in freshness and buys full CDN absorption of repeat load.
const CACHE_SECONDS = 900;

const CACHE_HEADERS = {
  "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
};

interface RouteParams {
  params: Promise<{ year: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { year } = await params;

    // Allowlist FIRST, before anything else touches the segment. The raw value
    // is never concatenated into an S3 key, a URL or a log line — it reaches
    // the key helper below only after being narrowed to a `HeatmapYear`, so
    // path traversal and bucket enumeration are structurally impossible rather
    // than filtered out after the fact.
    if (!isHeatmapYear(year)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: string | undefined;
    try {
      const obj = await s3Client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: heatmapArtifactKey(year) })
      );
      body = await obj.Body?.transformToString();
    } catch (error) {
      // An unbuilt or deleted year reads as absent to the studio, which then
      // simply hides the row. 404 is the honest code and it pages nobody.
      console.error("[heatmap] artifact read failed:", error);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!body) {
      console.error("[heatmap] artifact object had an empty body");
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let artifact: HeatmapArtifact;
    try {
      artifact = JSON.parse(body) as HeatmapArtifact;
    } catch (error) {
      // A corrupt object is a server-side problem, not a missing one.
      console.error("[heatmap] artifact parse failed:", error);
      return NextResponse.json(
        { error: "Failed to load heatmap" },
        { status: 500 }
      );
    }

    if (new URL(request.url).searchParams.get("meta")) {
      return NextResponse.json(artifact.meta, { headers: CACHE_HEADERS });
    }

    return NextResponse.json(artifact, { headers: CACHE_HEADERS });
  } catch (error) {
    // Never echo the S3 error, the bucket name or the key to the caller.
    console.error("[heatmap] Error serving heatmap:", error);
    return NextResponse.json(
      { error: "Failed to load heatmap" },
      { status: 500 }
    );
  }
}
