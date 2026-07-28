import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { GpxFile } from "@/entities/gpx-file";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import {
  s3Client,
  s3ClientForPresign,
  BUCKET,
  getRouteKey,
} from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";
import { PRESIGN_EXPIRY_SECONDS } from "@/lib/constants";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { validateRouteCard, sanitizeCardText } from "@/lib/route-card";
import { ROUTE_MAX_SIZE, isRouteCapped } from "@/lib/route-caps";
import { logEvent } from "@/lib/log-event";

/**
 * GET /api/gpx/routes - List the caller's own Route templates (byOwner).
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
      .byOwner({ ownerId: session.user.id })
      .go({ order: "desc", pages: "all" });

    // Hide failed uploads from the list; pending are shown so the client can
    // resume/confirm.
    const routes = result.data.filter((r) => r.status !== "failed");
    return NextResponse.json({ routes });
  } catch (error) {
    console.error("Error listing routes:", error);
    return NextResponse.json(
      { error: "Failed to list routes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gpx/routes - Create a Route template.
 *
 * Two variants:
 *  - Upload: { name, description?, routeType?, fileSize } → presigned PUT +
 *    Route row with status:"pending" (client must PUT then /confirm).
 *  - Convert: { fromFileId, name, description?, routeType? } → server-side S3
 *    copy of the caller's own ACTIVE GpxFile; Route is immediately active
 *    (bytes were already validated when the file was confirmed).
 *
 * Security (spec section 5): ownerId/routeId/S3 key are server-derived; card
 * text sanitized; per-user route cap; size cap enforced at presign
 * (ContentLength) and re-checked at confirm. Conversion NEVER carries
 * conDay/stravaActivityId — the Route entity has no such attributes.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const isAdmin = services.includes("admin");

    const card = validateRouteCard(body, { requireName: true });
    if (!card.ok) {
      return NextResponse.json({ error: card.error }, { status: 400 });
    }

    // Per-user route cap — checked before any presign/copy work.
    const mine = await Route.query
      .byOwner({ ownerId: session.user.id })
      .go({ pages: "all" });
    const liveCount = mine.data.filter((r) => r.status !== "failed").length;
    if (isRouteCapped(liveCount, isAdmin)) {
      return NextResponse.json(
        { error: "Route limit reached" },
        { status: 429 }
      );
    }

    const routeId = uuidv4();
    // Key carries no user identifier — presigned URLs expose the key path to
    // other signed-in users (see getRouteKey).
    const key = getRouteKey(routeId);
    const createdByName =
      sanitizeCardText(session.user.name ?? "").slice(0, 80) || undefined;

    const fromFileId = body?.fromFileId;
    if (fromFileId !== undefined) {
      // ---- Convert variant (run/file → route) ----
      if (typeof fromFileId !== "string" || !fromFileId) {
        return NextResponse.json(
          { error: "Invalid fromFileId" },
          { status: 400 }
        );
      }
      // Ownership check: only the caller's own file can seed a route.
      const source = await GpxFile.get({
        userId: session.user.id,
        fileId: fromFileId,
      }).go();
      if (!source.data || source.data.status !== "active") {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      await s3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKET,
          CopySource: encodeURI(`${source.data.bucket}/${source.data.key}`),
          Key: key,
        })
      );

      const created = await Route.create({
        routeId,
        ownerId: session.user.id,
        name: card.value.name!,
        description: card.value.description,
        routeType: card.value.routeType,
        bucket: BUCKET,
        key,
        fileSize: source.data.fileSize,
        trackCount: source.data.trackCount,
        waypointCount: source.data.waypointCount,
        totalDistance: source.data.totalDistance,
        totalElevation: source.data.totalElevation,
        bounds: source.data.bounds,
        status: "active",
        source: "converted",
        sourceGpxFileId: fromFileId,
        createdByName,
      }).go();

      logEvent("gpx.route.create", {
        headers: request.headers,
        userId: session.user.id,
        email: session.user.email ?? undefined,
        meta: { routeId, from: fromFileId },
      });

      return NextResponse.json({ route: created.data });
    }

    // ---- Upload variant ----
    const fileSize = body?.fileSize;
    if (
      typeof fileSize !== "number" ||
      !Number.isFinite(fileSize) ||
      fileSize <= 0
    ) {
      return NextResponse.json(
        { error: "fileSize is required" },
        { status: 400 }
      );
    }
    if (fileSize > ROUTE_MAX_SIZE) {
      return NextResponse.json(
        {
          error: "File too large",
          message: `Maximum route file size is ${ROUTE_MAX_SIZE / (1024 * 1024)} MB`,
          maxSize: ROUTE_MAX_SIZE,
        },
        { status: 413 }
      );
    }

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "application/gpx+xml",
      ContentLength: fileSize,
    });
    const uploadUrl = await getSignedUrl(s3ClientForPresign, command, {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
    });

    await Route.create({
      routeId,
      ownerId: session.user.id,
      name: card.value.name!,
      description: card.value.description,
      routeType: card.value.routeType,
      bucket: BUCKET,
      key,
      fileSize,
      status: "pending",
      source: "upload",
      createdByName,
    }).go();

    logEvent("gpx.route.create", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { routeId },
    });

    return NextResponse.json({ routeId, uploadUrl, key });
  } catch (error) {
    console.error("Error creating route:", error);
    return NextResponse.json(
      { error: "Failed to create route" },
      { status: 500 }
    );
  }
}
