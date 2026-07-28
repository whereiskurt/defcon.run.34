import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { s3Client, s3ClientForPresign, BUCKET } from "@/lib/s3-client";
import { PRESIGN_EXPIRY_SECONDS } from "@/lib/constants";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { validateRouteCard } from "@/lib/route-card";
import { ROUTE_MAX_SIZE } from "@/lib/route-caps";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/gpx/routes/[id] — owner, or anyone signed-in when published+active.
 * Anti-enumeration posture (spec section 5): private/unknown routes are an
 * identical 404 to non-owners — never a 403 oracle.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
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

    const downloadUrl = await getSignedUrl(
      s3ClientForPresign,
      new GetObjectCommand({ Bucket: BUCKET, Key: route.data.key }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS }
    );

    // Non-owners get the public shape only (no ownerId leak).
    const r = route.data;
    const publicShape = {
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
      visibility: r.visibility,
      status: r.status,
    };

    return NextResponse.json({
      route: isOwner ? r : publicShape,
      downloadUrl,
    });
  } catch (error) {
    console.error("Error fetching route:", error);
    return NextResponse.json({ error: "Failed to get route" }, { status: 500 });
  }
}

/**
 * PUT /api/gpx/routes/[id] — owner only (404 otherwise).
 * Card metadata edit (sanitized) and/or `{updateContent:true, fileSize}` which
 * re-presigns the SAME key and drops the route back to pending until the
 * client re-confirms. Publishing fields are NOT writable here.
 */
export async function PUT(request: Request, { params }: RouteParams) {
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

    const body = await request.json();
    const card = validateRouteCard(body, { requireName: false });
    if (!card.ok) {
      return NextResponse.json({ error: card.error }, { status: 400 });
    }

    let uploadUrl: string | undefined;
    const patch: Record<string, unknown> = { ...card.value };

    if (body?.updateContent === true) {
      const fileSize = body?.fileSize;
      if (
        typeof fileSize !== "number" ||
        !Number.isFinite(fileSize) ||
        fileSize <= 0
      ) {
        return NextResponse.json(
          { error: "fileSize is required to update content" },
          { status: 400 }
        );
      }
      if (fileSize > ROUTE_MAX_SIZE) {
        return NextResponse.json(
          { error: "File too large", maxSize: ROUTE_MAX_SIZE },
          { status: 413 }
        );
      }
      uploadUrl = await getSignedUrl(
        s3ClientForPresign,
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: route.data.key,
          ContentType: "application/gpx+xml",
          ContentLength: fileSize,
        }),
        { expiresIn: PRESIGN_EXPIRY_SECONDS }
      );
      patch.status = "pending";
      patch.fileSize = fileSize;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await Route.update({ routeId: id })
      .set(patch)
      .go({ response: "all_new" });

    return NextResponse.json({
      route: updated.data,
      ...(uploadUrl ? { uploadUrl } : {}),
    });
  } catch (error) {
    console.error("Error updating route:", error);
    return NextResponse.json(
      { error: "Failed to update route" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gpx/routes/[id] — owner only (404 otherwise).
 * Deletes the S3 object then the row.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
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

    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: BUCKET, Key: route.data.key })
      );
    } catch (s3Error) {
      // Row deletion still proceeds; orphaned objects are unreachable (keys
      // are uuid-based and never listed).
      console.error("Error deleting route object:", s3Error);
    }

    await Route.delete({ routeId: id }).go();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting route:", error);
    return NextResponse.json(
      { error: "Failed to delete route" },
      { status: 500 }
    );
  }
}
