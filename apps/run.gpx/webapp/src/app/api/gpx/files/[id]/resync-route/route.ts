import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "@/entities/gpx-file";
import { Route } from "@/entities/route";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { assertNotLockedLive } from "@/lib/live-lockout";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/resync-route — push a published route's latest
 * content to its public copy (2026-08-01 unified-routes spec).
 *
 * Called by auto-save after the browser's S3 PUT lands, and only for rows the
 * client already knows are Public. The copy happens server-side (S3 → S3), so
 * the browser uploads exactly once regardless of publish state.
 *
 * Always 200 with { synced }. A not-published or already-gone route is a no-op,
 * not an error: auto-save must never surface a failure for a background mirror
 * of content that saved fine.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { id } = await params;
  const userId = session.user.id;

  try {
    const fileResult = await GpxFile.get({ userId, fileId: id }).go();
    const file = fileResult.data;
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!file.publishedRouteId) {
      return NextResponse.json({ synced: false });
    }

    const routeResult = await Route.get({ routeId: file.publishedRouteId }).go();
    const route = routeResult.data;
    if (!route || route.ownerId !== userId) {
      return NextResponse.json({ synced: false });
    }

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${file.bucket}/${file.key}`),
        Key: route.key,
      })
    );

    await Route.update({ routeId: route.routeId })
      .set({
        fileSize: file.fileSize,
        trackCount: file.trackCount,
        waypointCount: file.waypointCount,
        totalDistance: file.totalDistance,
        totalElevation: file.totalElevation,
        bounds: file.bounds,
      })
      .go();

    return NextResponse.json({ synced: true });
  } catch (error) {
    console.error("Error resyncing published route:", error);
    return NextResponse.json({ error: "Failed to resync" }, { status: 500 });
  }
}
