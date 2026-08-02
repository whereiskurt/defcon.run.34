import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Route } from "@/entities/route";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/gpx/admin/routes/[id] — admin moderation HARD delete.
 * Non-admins get 404 (non-disclosure), same as the sibling unpublish route.
 *
 * The softer action is POST .../unpublish, which only pulls the route off the
 * community map and leaves the owner able to re-publish. This one removes the
 * Route row and its S3 object outright, and is destructive in a way that
 * depends on what backs the route:
 *
 *   - backed by a GpxFile → the owner keeps their file; only the public copy
 *     dies, and we clear their publishedRouteId so their row is not left
 *     pointing at a Route that no longer exists.
 *   - ORPHAN (no sourceGpxFileId, from the retired card form) → the Route row
 *     IS the route. Deleting destroys the owner's only copy.
 *
 * `hadBackingFile` is returned so the caller can say which of those happened;
 * the UI warns BEFORE calling for the orphan case.
 *
 * Copies other runners already made are independent GpxFile rows and are
 * deliberately untouched.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await Route.get({ routeId: id }).go();
    const route = result.data;
    if (!route) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }

    // Clear the owner's back-pointer first. If the S3 delete or row delete
    // fails afterwards the worst case is a file whose publishedRouteId is
    // absent while a Route lingers — recoverable by re-publishing. The reverse
    // order would leave the owner's row pointing at a deleted Route.
    let hadBackingFile = false;
    if (route.sourceGpxFileId) {
      const file = await GpxFile.get({
        userId: route.ownerId,
        fileId: route.sourceGpxFileId,
      }).go();
      if (file.data) {
        hadBackingFile = true;
        await GpxFile.update({
          userId: route.ownerId,
          fileId: route.sourceGpxFileId,
        })
          .remove(["publishedRouteId"])
          .go();
      }
    }

    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: route.key })
    );
    await Route.delete({ routeId: id }).go();

    logEvent("gpx.route.admin_delete", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: {
        routeId: id,
        name: route.name,
        ownerId: route.ownerId,
        hadBackingFile,
      },
    });

    return NextResponse.json({ deleted: true, hadBackingFile });
  } catch (error) {
    console.error("Error deleting route (admin):", error);
    return NextResponse.json(
      { error: "Failed to delete route" },
      { status: 500 }
    );
  }
}
