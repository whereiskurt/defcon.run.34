import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client } from "@/lib/s3-client";
import { trkptCoords } from "@/lib/heatmap-artifact";

/**
 * GET /api/gpx/public/aggregate - Public, UNAUTHENTICATED "All Runners" aggregate (Phase 32).
 *
 * Returns a single blended, NON-ATTRIBUTABLE GeoJSON of every route whose owner opted in
 * (`includeInAggregate:true`). Each track is a bare LineString with NO properties — no name,
 * no id, no user — so nothing is individually identifiable. The studio renders it as one
 * low-opacity "All Runners" layer (overlap = density). This is the only public surface
 * permitted for Strava-derived routes (per the compliance model).
 *
 * NOTE: builds on-demand with a short cache. At larger scale, precompute to an S3 artifact
 * on the Phase 31b scheduler and serve that instead (see PHASE-31B-STRAVA.md).
 */

const CACHE_SECONDS = 600;
const MAX_ROUTES = 500; // bound on-demand cost; log if exceeded

export async function GET() {
  try {
    const scan = await GpxFile.scan
      .where(
        (attr, op) =>
          `${op.eq(attr.includeInAggregate, true)} AND ${op.eq(attr.status, "active")}`
      )
      .go({ pages: "all" });

    const files = scan.data.slice(0, MAX_ROUTES);
    if (scan.data.length > MAX_ROUTES) {
      console.warn(
        `[aggregate] ${scan.data.length} opted-in routes; capped at ${MAX_ROUTES} — precompute recommended`
      );
    }

    const features = await Promise.all(
      files.map(async (f) => {
        try {
          const obj = await s3Client.send(
            new GetObjectCommand({ Bucket: f.bucket, Key: f.key })
          );
          const gpx = await obj.Body?.transformToString();
          if (!gpx) return null;
          const coordinates = trkptCoords(gpx);
          if (coordinates.length < 2) return null;
          // Bare geometry — deliberately NO properties (non-attributable).
          return {
            type: "Feature" as const,
            properties: {},
            geometry: { type: "LineString" as const, coordinates },
          };
        } catch {
          return null;
        }
      })
    );

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: features.filter(Boolean),
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    console.error("Error building aggregate:", error);
    return NextResponse.json(
      { error: "Failed to build aggregate" },
      { status: 500 }
    );
  }
}
