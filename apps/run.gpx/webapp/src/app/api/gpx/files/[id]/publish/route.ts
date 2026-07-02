import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFile } from "@/entities/gpx-file";
import { GpxFolder } from "@/entities/gpx-folder";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/publish - Publish an owned route into a GLOBAL folder.
 *
 * Admin-only (mirrors the global-folder-create gating). COPIES the route (S3 object +
 * a new GpxFile row) into the target GLOBAL folder — the admin's original private route
 * is untouched. Attribution is preserved via `uploadedBy`. The copy then appears in the
 * public overlay for everyone (Phase 28).
 *
 * Body: { folderId: string }  — target GLOBAL folder id.
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
  // Publishing to a GLOBAL folder is admin-only (same gate as creating one).
  if (!services.includes("admin")) {
    return NextResponse.json(
      { error: "Only admins can publish public maps" },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const { folderId } = await request.json();
    if (!folderId || typeof folderId !== "string") {
      return NextResponse.json(
        { error: "folderId is required" },
        { status: 400 }
      );
    }

    // Target must be an existing GLOBAL folder.
    const folder = await GpxFolder.get({
      userId: "GLOBAL",
      folderId,
    }).go();
    if (!folder.data || !folder.data.isGlobal) {
      return NextResponse.json(
        { error: "Target GLOBAL folder not found" },
        { status: 404 }
      );
    }

    // Source must be the admin's own, active route.
    const source = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();
    if (!source.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (source.data.status !== "active") {
      return NextResponse.json(
        { error: "Only an active route can be published" },
        { status: 400 }
      );
    }
    // Compliance: raw Strava imports must be converted before public exposure.
    if (source.data.publicShareEligible === false) {
      return NextResponse.json(
        {
          error:
            "This route isn't eligible for public sharing. Use 'Convert to public' first.",
        },
        { status: 400 }
      );
    }

    // Copy the S3 object into the GLOBAL keyspace under a fresh id.
    const newFileId = uuidv4();
    const newKey = `${getUserPrefix("GLOBAL")}${newFileId}.gpx`;
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${source.data.bucket}/${source.data.key}`),
        Key: newKey,
      })
    );

    // Create the GLOBAL metadata row (copy, not move — original untouched).
    const published = await GpxFile.create({
      userId: "GLOBAL",
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
      folderId,
      uploadedBy: session.user.id,
      status: "active",
    }).go();

    return NextResponse.json({ file: published.data });
  } catch (error) {
    console.error("Error publishing GPX file:", error);
    return NextResponse.json(
      { error: "Failed to publish file" },
      { status: 500 }
    );
  }
}
