import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";

/**
 * GET /api/gpx/files - List user's GPX files
 * Query params:
 *   - folderId (optional) - Filter by folder. Omit or "root" for root level files.
 *   - global (optional) - If "true", list files from global context
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  const isGlobal = searchParams.get("global") === "true";
  const targetUserId = isGlobal ? "GLOBAL" : session.user.id;

  try {
    // Use "ROOT" as sentinel value for root-level files
    const targetFolderId = (folderId && folderId !== "root") ? folderId : "ROOT";

    const result = await GpxFile.query
      .byFolder({ userId: targetUserId, folderId: targetFolderId })
      .go({ order: "desc" });
    const files = result.data;

    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error listing GPX files:", error);
    return NextResponse.json(
      { error: "Failed to list files" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gpx/files - Create new file record and return presigned upload URL
 * Request body:
 *   - fileName (required)
 *   - fileSize (optional)
 *   - folderId (optional) - Folder to save to
 *   - trackCount, waypointCount, totalDistance, totalElevation (optional metadata)
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

  try {
    const {
      fileName,
      fileSize,
      folderId,
      trackCount,
      waypointCount,
      totalDistance,
      totalElevation,
    } = await request.json();

    if (!fileName) {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 }
      );
    }

    // Determine if saving to a global folder
    let targetUserId = session.user.id;
    let isGlobalFolder = false;
    let validatedFolderId = "ROOT"; // Default to ROOT

    if (folderId) {
      // Check if this is a global folder
      const { GpxFolder } = await import("@/entities/gpx-folder");

      // Try user folder first
      let folder = await GpxFolder.get({
        userId: session.user.id,
        folderId,
      }).go();

      if (folder.data) {
        validatedFolderId = folderId;
      } else {
        // Check global folder
        folder = await GpxFolder.get({
          userId: "GLOBAL",
          folderId,
        }).go();

        if (folder.data) {
          isGlobalFolder = true;
          targetUserId = "GLOBAL";
          validatedFolderId = folderId;
        }
        // If folder not found, validatedFolderId remains ROOT
        // This handles stale folder references from client state
      }
    }

    const fileId = uuidv4();
    const key = `${getUserPrefix(targetUserId)}${fileId}.gpx`;

    // Generate presigned upload URL
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "application/gpx+xml",
    });

    const uploadUrl = await getSignedUrl(s3ClientForPresign, command, { expiresIn: 3600 });

    // Create DynamoDB record
    await GpxFile.create({
      userId: targetUserId,
      fileId,
      fileName,
      bucket: BUCKET,
      key,
      fileSize: fileSize || 0,
      folderId: validatedFolderId, // Use validated folder or ROOT if not found
      trackCount: trackCount || 0,
      waypointCount: waypointCount || 0,
      totalDistance: totalDistance || 0,
      totalElevation: totalElevation || 0,
      uploadedBy: isGlobalFolder ? session.user.id : undefined,
    }).go();

    return NextResponse.json({ uploadUrl, fileId, key });
  } catch (error) {
    console.error("Error creating GPX file:", error);
    return NextResponse.json(
      { error: "Failed to create file" },
      { status: 500 }
    );
  }
}
