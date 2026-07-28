import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { validateGpxFile } from "@/lib/gpx-validator";
import { summarizeGpxObject } from "@/lib/route-summary";
import { assertNotLockedLive } from "@/lib/live-lockout";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/routes/[id]/confirm — validate the uploaded bytes and flip the
 * route pending→active, computing the geometry summary SERVER-SIDE (client
 * metadata is never trusted for routes).
 *
 * On validation failure the S3 object is deleted and the row marked failed —
 * same posture as the GpxFile confirm. Unlike GpxFile there is no leaderboard
 * reconcile here: routes never score.
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

  try {
    const route = await Route.get({ routeId: id }).go();
    if (!route.data || route.data.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }

    if (route.data.status !== "pending") {
      if (route.data.status === "active") {
        return NextResponse.json({
          success: true,
          route: route.data,
          message: "Route already confirmed",
        });
      }
      return NextResponse.json(
        { error: `Cannot confirm route with status: ${route.data.status}` },
        { status: 400 }
      );
    }

    const validationResult = await validateGpxFile(route.data.key);

    if (!validationResult.valid) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: route.data.key })
        );
      } catch (s3Error) {
        console.error("[route confirm] Failed to delete S3 object:", s3Error);
      }

      await Route.update({ routeId: id }).set({ status: "failed" }).go();

      return NextResponse.json(
        { error: "Invalid GPX file", message: validationResult.error },
        { status: 400 }
      );
    }

    // Server-derived geometry summary (never trusted from the client).
    const summary = await summarizeGpxObject(route.data.key);

    const result = await Route.update({ routeId: id })
      .set({
        status: "active",
        trackCount: summary.trackCount,
        waypointCount: summary.waypointCount,
        totalDistance: summary.totalDistance,
        totalElevation: summary.totalElevation,
        ...(summary.bounds ? { bounds: summary.bounds } : {}),
      })
      .go({ response: "all_new" });

    return NextResponse.json({ success: true, route: result.data });
  } catch (error) {
    console.error("Error confirming route:", error);
    return NextResponse.json(
      { error: "Failed to confirm route" },
      { status: 500 }
    );
  }
}
