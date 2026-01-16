import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { GpxShare } from "@/entities/gpx-share";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { s3Client, s3ClientForPresign, getUserPrefix, BUCKET } from "@/lib/s3-client";

const MAX_VERSIONS = 50;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/gpx/files/[id] - Get file metadata and presigned download URL
 */
export async function GET(request: Request, { params }: RouteParams) {
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
    // Try user file first
    let result = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();

    let targetUserId = session.user.id;

    // If not found, try global file
    if (!result.data) {
      result = await GpxFile.get({
        userId: "GLOBAL",
        fileId: id,
      }).go();
      targetUserId = "GLOBAL";
    }

    if (!result.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Generate presigned download URL
    const command = new GetObjectCommand({
      Bucket: result.data.bucket,
      Key: result.data.key,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    // Update last opened timestamp
    await GpxFile.update({
      userId: targetUserId,
      fileId: id,
    })
      .set({ lastOpenedAt: Date.now() })
      .go();

    return NextResponse.json({
      file: result.data,
      downloadUrl,
    });
  } catch (error) {
    console.error("Error getting GPX file:", error);
    return NextResponse.json({ error: "Failed to get file" }, { status: 500 });
  }
}

/**
 * PUT /api/gpx/files/[id] - Update file metadata or content
 * Request body can include:
 * - fileName, folderId (to move file), and other metadata
 * - updateContent: true to get a presigned URL for uploading new content
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

  const { id } = await params;

  try {
    const updates = await request.json();

    // Try user file first
    let file = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();

    let targetUserId = session.user.id;

    // If not found, try global file
    if (!file.data) {
      file = await GpxFile.get({
        userId: "GLOBAL",
        fileId: id,
      }).go();

      if (!file.data) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // For global files, only uploader or admin can modify
      const isAdmin = services.includes("admin");
      if (file.data.uploadedBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the uploader or admin can modify this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Only allow updating specific fields
    const allowedFields = [
      "fileName",
      "fileSize",
      "trackCount",
      "waypointCount",
      "totalDistance",
      "totalElevation",
      "bounds",
      "folderId", // Allow moving files between folders
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Handle folderId: null means move to root (use "ROOT" sentinel)
        if (field === "folderId") {
          filteredUpdates[field] = updates[field] || "ROOT";
        } else {
          filteredUpdates[field] = updates[field];
        }
      }
    }

    // If updateContent is requested, generate presigned upload URL for a new version
    let uploadUrl: string | undefined;
    let newVersion: number | undefined;
    let versionedKey: string | undefined;

    if (updates.updateContent) {
      // Calculate new version
      const currentVersion = file.data.version || 1;
      newVersion = currentVersion + 1;

      // Cap versionCount at MAX_VERSIONS
      const newVersionCount = Math.min(newVersion, MAX_VERSIONS);

      // Generate versioned S3 key: uploads/{userId}/gpx/{fileId}.v{version}.gpx
      // Use the appropriate userId prefix (either user's ID or GLOBAL)
      const prefix = getUserPrefix(targetUserId);
      versionedKey = `${prefix}${id}.v${newVersion}.gpx`;

      // Update version fields in filteredUpdates
      filteredUpdates.version = newVersion;
      filteredUpdates.versionCount = newVersionCount;

      // Prune oldest version if we exceeded MAX_VERSIONS
      if (newVersion > MAX_VERSIONS) {
        const versionToDelete = newVersion - MAX_VERSIONS;
        const keyToDelete = `${prefix}${id}.v${versionToDelete}.gpx`;
        await s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: keyToDelete,
        }));
      }

      const putCommand = new PutObjectCommand({
        Bucket: BUCKET,
        Key: versionedKey,
        ContentType: "application/gpx+xml",
      });
      // Use s3ClientForPresign to avoid checksum header issues with browser uploads
      uploadUrl = await getSignedUrl(s3ClientForPresign, putCommand, {
        expiresIn: 3600,
      });
    }

    const result = await GpxFile.update({
      userId: targetUserId,
      fileId: id,
    })
      .set(filteredUpdates)
      .go({ response: "all_new" });

    const response: {
      file: typeof result.data;
      uploadUrl?: string;
      version?: number;
      versionedKey?: string;
    } = {
      file: result.data,
    };
    if (uploadUrl) {
      response.uploadUrl = uploadUrl;
      response.version = newVersion;
      response.versionedKey = versionedKey;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error updating GPX file:", error);
    return NextResponse.json(
      { error: "Failed to update file" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gpx/files/[id] - Delete file from S3 and DynamoDB
 */
export async function DELETE(request: Request, { params }: RouteParams) {
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
    // Try user file first
    let file = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();

    let targetUserId = session.user.id;

    // If not found, try global file
    if (!file.data) {
      file = await GpxFile.get({
        userId: "GLOBAL",
        fileId: id,
      }).go();

      if (!file.data) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // For global files, only uploader or admin can delete
      const isAdmin = services.includes("admin");
      if (file.data.uploadedBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the uploader or admin can delete this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Delete all shares associated with this file (cascade delete)
    const shares = await GpxShare.query
      .byFile({ ownerId: targetUserId, fileId: id })
      .go();

    for (const share of shares.data) {
      await GpxShare.delete({ shareId: share.shareId }).go();
    }

    // Delete from S3
    const deleteCommand = new DeleteObjectCommand({
      Bucket: file.data.bucket,
      Key: file.data.key,
    });
    await s3Client.send(deleteCommand);

    // Delete from DynamoDB
    await GpxFile.delete({
      userId: targetUserId,
      fileId: id,
    }).go();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting GPX file:", error);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gpx/files/[id] - Finalize version upload by copying versioned file to current key
 * Request body:
 * - versionedKey: The S3 key of the uploaded versioned file
 *
 * This should be called after successfully uploading to the presigned URL returned by PUT
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
    const { versionedKey } = await request.json();

    if (!versionedKey) {
      return NextResponse.json(
        { error: "versionedKey is required" },
        { status: 400 }
      );
    }

    // Try user file first
    let file = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();

    let targetUserId = session.user.id;

    // If not found, try global file
    if (!file.data) {
      file = await GpxFile.get({
        userId: "GLOBAL",
        fileId: id,
      }).go();

      if (!file.data) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // For global files, only uploader or admin can modify
      const isAdmin = services.includes("admin");
      if (file.data.uploadedBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the uploader or admin can modify this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Validate that the versionedKey is for this file
    const expectedPrefix = `${getUserPrefix(targetUserId)}${id}.v`;
    if (!versionedKey.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: "Invalid versionedKey for this file" },
        { status: 400 }
      );
    }

    // Copy the versioned file to the current (non-versioned) key
    const copyCommand = new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${versionedKey}`,
      Key: file.data.key,
      ContentType: "application/gpx+xml",
    });

    await s3Client.send(copyCommand);

    return NextResponse.json({
      success: true,
      file: file.data,
    });
  } catch (error) {
    console.error("Error finalizing GPX file version:", error);
    return NextResponse.json(
      { error: "Failed to finalize version" },
      { status: 500 }
    );
  }
}
