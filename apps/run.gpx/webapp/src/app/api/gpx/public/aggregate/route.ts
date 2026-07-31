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
 * low-opacity "All Runners" layer (overlap = density).
 *
 * SUPERSEDED CLAIM — Phase 71, HEAT-06, 2026-07-30. This comment used to assert that the
 * route you are reading was the single place Strava-derived geometry could ever be
 * published. Phase 71 falsified that: it added `/api/gpx/public/heatmap/[year]` as a
 * SECOND non-attributable public surface. The heat map sources EVERY con-day-assigned run
 * that has geometry and applies NO owner opt-in filter — `includeInAggregate` gates this
 * route and nothing else. Kurt made that call on 2026-07-30 with the superseded sentence
 * explicitly in front of him, so the widening is a decision, not drift.
 *
 * The compensating control is structural rather than consent-based: heat-map output is
 * bare geometry with zero properties, and `assertNonAttributable()` in
 * `lib/heatmap-artifact.ts` throws — refusing publication outright — if anything that
 * could identify a runner ever attaches itself. `lib/heatmap-build.ts` holds the selection.
 *
 * DO NOT "restore" an opt-in predicate to the heat-map builder on the strength of the
 * opt-in language above: that language describes THIS route's behaviour, not the heat
 * map's. Re-adding such a filter to the builder would quietly reverse a decision that is
 * recorded here on purpose.
 *
 * NOTE: builds on-demand with a short cache. At larger scale, precompute to an S3 artifact
 * on the Phase 31b scheduler and serve that instead (see PHASE-31B-STRAVA.md). Phase 71
 * did exactly that for the heat map — its artifact is precomputed to S3 and the serve
 * route only reads the object — so the migration path is already proven in this codebase.
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
