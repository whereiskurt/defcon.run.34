import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/convert-public - "Convert to public" (Phase 31).
 *
 * The compliance linchpin (Strava API terms): a raw Strava import is
 * `publicShareEligible:false` and cannot be shared publicly as-is. This explicit user
 * action mints a CONVERTED copy of the route (owned by the same user) with
 * `source:"converted"` and `publicShareEligible:true` — that copy may then flow through
 * the normal request-sharing / admin-publish path. The raw import is left untouched, and
 * the converted copy deliberately does NOT carry `stravaActivityId`.
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

  const { id } = await params;

  try {
    const source = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();
    if (!source.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (source.data.status !== "active") {
      return NextResponse.json(
        { error: "Only an active route can be converted" },
        { status: 400 }
      );
    }
    // Already eligible (upload/draw/already-converted) — nothing to convert.
    if (source.data.publicShareEligible !== false) {
      return NextResponse.json(
        { error: "This route is already eligible for public sharing" },
        { status: 400 }
      );
    }

    // Copy into the user's own keyspace under a fresh id.
    const newFileId = uuidv4();
    const newKey = `${getUserPrefix(session.user.id)}${newFileId}.gpx`;
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${source.data.bucket}/${source.data.key}`),
        Key: newKey,
      })
    );

    const converted = await GpxFile.create({
      userId: session.user.id,
      fileId: newFileId,
      fileName: source.data.fileName,
      bucket: BUCKET,
      key: newKey,
      fileSize: source.data.fileSize,
      trackCount: source.data.trackCount,
      waypointCount: source.data.waypointCount,
      totalDistance: source.data.totalDistance,
      totalElevation: source.data.totalElevation,
      bounds: source.data.bounds,
      folderId: source.data.folderId,
      source: "converted",
      publicShareEligible: true,
      status: "active",
    }).go();

    return NextResponse.json({ file: converted.data });
  } catch (error) {
    console.error("Error converting route to public:", error);
    return NextResponse.json(
      { error: "Failed to convert route" },
      { status: 500 }
    );
  }
}
