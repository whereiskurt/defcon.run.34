import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign, BUCKET } from "@/lib/s3-client";
import { PRESIGN_EXPIRY_SECONDS } from "@/lib/constants";

/** Page cap for the community listing (spec section 5, abuse limits). */
const COMMUNITY_PAGE_LIMIT = 100;

/**
 * GET /api/gpx/routes/community — published routes for all signed-in runners.
 * byVisibility GSI query (published rows only — private routes are not even in
 * the index). Attribution is createdByName only; the raw ownerId (OIDC sub) is
 * never exposed here.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const result = await Route.query
      .byVisibility({ visibility: "published" })
      .go({ order: "desc", limit: COMMUNITY_PAGE_LIMIT });

    const published = result.data.filter((r) => r.status === "active");

    const routes = await Promise.all(
      published.map(async (r) => ({
        routeId: r.routeId,
        name: r.name,
        description: r.description,
        routeType: r.routeType,
        trackCount: r.trackCount,
        waypointCount: r.waypointCount,
        totalDistance: r.totalDistance,
        totalElevation: r.totalElevation,
        bounds: r.bounds,
        createdByName: r.createdByName,
        copyCount: r.copyCount,
        publishedAt: r.publishedAt,
        downloadUrl: await getSignedUrl(
          s3ClientForPresign,
          new GetObjectCommand({ Bucket: BUCKET, Key: r.key }),
          { expiresIn: PRESIGN_EXPIRY_SECONDS }
        ),
      }))
    );

    return NextResponse.json(
      { routes },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    console.error("Error listing community routes:", error);
    return NextResponse.json(
      { error: "Failed to list community routes" },
      { status: 500 }
    );
  }
}
