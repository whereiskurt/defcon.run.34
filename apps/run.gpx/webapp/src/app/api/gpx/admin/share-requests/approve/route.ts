import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFile } from "@/entities/gpx-file";
import { GpxFolder } from "@/entities/gpx-folder";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";

/**
 * POST /api/gpx/admin/share-requests/approve - Approve a community route (Phase 30).
 *
 * Admin-only. Copies a flagged user's route into a target GLOBAL folder ("Rabbit Routes")
 * — copy, not move; attribution via `uploadedBy`. Then clears `shareRequested` on the
 * source so it leaves the curation queue. Declining is simply not approving (optionally
 * the owner un-toggles the flag).
 *
 * NOTE (Phase 31 compliance): once Strava import lands, this path must reject sources with
 * `publicShareEligible === false` (raw Strava) until the user runs "Convert to public".
 *
 * Body: { userId: string, fileId: string, folderId: string }
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("admin")) {
    return NextResponse.json(
      { error: "Only admins can approve share requests" },
      { status: 403 }
    );
  }

  try {
    const { userId, fileId, folderId } = await request.json();
    if (!userId || !fileId || !folderId) {
      return NextResponse.json(
        { error: "userId, fileId and folderId are required" },
        { status: 400 }
      );
    }

    // Target must be an existing GLOBAL folder.
    const folder = await GpxFolder.get({ userId: "GLOBAL", folderId }).go();
    if (!folder.data || !folder.data.isGlobal) {
      return NextResponse.json(
        { error: "Target GLOBAL folder not found" },
        { status: 404 }
      );
    }

    // Source must be the flagged, active route it claims to be.
    const source = await GpxFile.get({ userId, fileId }).go();
    if (!source.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!source.data.shareRequested) {
      return NextResponse.json(
        { error: "This route has not been submitted for sharing" },
        { status: 400 }
      );
    }
    if (source.data.status !== "active") {
      return NextResponse.json(
        { error: "Only an active route can be approved" },
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
      uploadedBy: userId,
      status: "active",
    }).go();

    // Clear the flag on the source so it leaves the curation queue.
    await GpxFile.update({ userId, fileId }).set({ shareRequested: false }).go();

    return NextResponse.json({ file: published.data });
  } catch (error) {
    console.error("Error approving share request:", error);
    return NextResponse.json(
      { error: "Failed to approve share request" },
      { status: 500 }
    );
  }
}
