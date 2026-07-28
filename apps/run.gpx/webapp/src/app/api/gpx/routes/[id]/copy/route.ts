import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { GpxFile } from "@/entities/gpx-file";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { buildRouteCopyPayload } from "@/lib/route-copy";
import { COPY_FILE_SANITY_CAP } from "@/lib/route-caps";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/routes/[id]/copy — "Add to My Maps": snapshot a published (or
 * caller-owned) route into the caller's own files as a private, DATELESS
 * GpxFile (explicit product decision: copy, not subscription).
 *
 * Double-scoring guard: the created GpxFile has no conDay/stravaActivityId
 * (test-locked in buildRouteCopyPayload) so it can never score. Abuse guard:
 * refused when the caller already holds COPY_FILE_SANITY_CAP files.
 */
export async function POST(request: Request, { params }: RouteParams) {
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
    const isOwner = route.data?.ownerId === session.user.id;
    const isPublished =
      route.data?.visibility === "published" && route.data?.status === "active";
    if (!route.data || (!isOwner && !isPublished)) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }

    // Sanity cap on total files — this endpoint must not become an unbounded
    // row/object mint. Single-partition count, cheap.
    const files = await GpxFile.query
      .byCreatedAt({ userId: session.user.id })
      .go({ pages: "all" });
    if (files.data.length >= COPY_FILE_SANITY_CAP) {
      return NextResponse.json(
        { error: "File limit reached" },
        { status: 429 }
      );
    }

    const newFileId = uuidv4();
    const newKey = `${getUserPrefix(session.user.id)}${newFileId}.gpx`;

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${route.data.bucket}/${route.data.key}`),
        Key: newKey,
      })
    );

    await GpxFile.create(
      buildRouteCopyPayload(route.data, session.user.id, newFileId, BUCKET, newKey)
    ).go();

    // Server-incremented popularity counter; client input never touches it.
    await Route.update({ routeId: id }).add({ copyCount: 1 }).go();

    logEvent("gpx.route.copy", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { routeId: id, fileId: newFileId },
    });

    return NextResponse.json({ fileId: newFileId });
  } catch (error) {
    console.error("Error copying route:", error);
    return NextResponse.json(
      { error: "Failed to copy route" },
      { status: 500 }
    );
  }
}
