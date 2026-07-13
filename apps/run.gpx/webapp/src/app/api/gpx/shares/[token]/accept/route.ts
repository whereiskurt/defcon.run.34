import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxShare } from "@/entities/gpx-share";
import { GpxFile } from "@/entities/gpx-file";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";
import { logEvent } from "@/lib/log-event";
import { assertNotLockedLive } from "@/lib/live-lockout";

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * POST /api/gpx/shares/[token]/accept - Accept a share and copy the file
 *
 * This endpoint:
 * 1. Validates the share token
 * 2. Checks access permissions (public = any auth user, private = email check)
 * 3. Copies the S3 object from owner's storage to recipient's storage
 * 4. Creates a new GpxFile record for the recipient
 *
 * Returns:
 *   - fileId: The new file ID in recipient's storage
 *   - fileName: The file name
 *   - version: Always 1 (fresh copy)
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

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { token } = await params;

  try {
    // Step 1: Look up share by shareId (token)
    const shareResult = await GpxShare.get({
      shareId: token,
    }).go();

    if (!shareResult.data) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const share = shareResult.data;

    // Step 2: Check if share has expired
    if (share.expiresAt && share.expiresAt < Date.now()) {
      return NextResponse.json({ error: "Share has expired" }, { status: 404 });
    }

    // Step 3: Validate access permissions
    // Use case-insensitive email comparison and return 404 to prevent token enumeration
    if (share.accessMode === "private") {
      const userEmail = session.user.email?.toLowerCase();
      const normalizedAllowed = (share.allowedEmails || []).map(e => e.toLowerCase());

      if (!userEmail || !normalizedAllowed.includes(userEmail)) {
        // Return 404 to avoid revealing that a valid private share exists
        return NextResponse.json({ error: "Share not found" }, { status: 404 });
      }
    }
    // For public shares, any authenticated user can accept

    // Step 4: Get the original file metadata from owner's storage
    let fileResult = await GpxFile.get({
      userId: share.ownerId,
      fileId: share.fileId,
    }).go();

    let ownerUserId = share.ownerId;

    if (!fileResult.data) {
      // Try GLOBAL storage
      fileResult = await GpxFile.get({
        userId: "GLOBAL",
        fileId: share.fileId,
      }).go();
      ownerUserId = "GLOBAL";
    }

    if (!fileResult.data) {
      return NextResponse.json(
        { error: "Shared file no longer exists" },
        { status: 404 }
      );
    }

    const originalFile = fileResult.data;

    // Step 5: Copy S3 object from owner's storage to recipient's storage
    // Version 1 files are stored without version suffix: uploads/{ownerId}/gpx/{fileId}.gpx
    // Version 2+ files use versioned suffix: uploads/{ownerId}/gpx/{fileId}.v{version}.gpx
    const sourceKey =
      share.version === 1
        ? `${getUserPrefix(ownerUserId)}${share.fileId}.gpx`
        : `${getUserPrefix(ownerUserId)}${share.fileId}.v${share.version}.gpx`;

    // Generate new fileId for recipient
    const newFileId = uuidv4();

    // Destination key (new file starts at v1): uploads/{recipientId}/gpx/{newFileId}.gpx
    // Note: Using non-versioned key for the initial copy. The versioned key will be
    // created when the user saves changes (following the standard versioning flow).
    const destKey = `${getUserPrefix(session.user.id)}${newFileId}.gpx`;

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${sourceKey}`,
        Key: destKey,
      })
    );

    // Step 6: Create new GpxFile record for recipient
    await GpxFile.create({
      userId: session.user.id,
      fileId: newFileId,
      fileName: originalFile.fileName,
      bucket: BUCKET,
      key: destKey,
      fileSize: originalFile.fileSize,
      folderId: "ROOT", // New file goes to root folder
      trackCount: originalFile.trackCount || 0,
      waypointCount: originalFile.waypointCount || 0,
      totalDistance: originalFile.totalDistance || 0,
      totalElevation: originalFile.totalElevation || 0,
      bounds: originalFile.bounds,
      version: 1,
      versionCount: 1,
    }).go();

    // Activity signal (AR-02): a shared route was accepted and copied to the recipient.
    logEvent("gpx.share.accept", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { token, fileId: newFileId },
    });

    return NextResponse.json({
      fileId: newFileId,
      fileName: originalFile.fileName,
      version: 1,
    });
  } catch (error) {
    console.error("Error accepting share:", error);
    return NextResponse.json(
      { error: "Failed to accept share" },
      { status: 500 }
    );
  }
}
