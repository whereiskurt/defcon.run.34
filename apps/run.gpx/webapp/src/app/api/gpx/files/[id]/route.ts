import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { s3Client } from "@/lib/s3-client";

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

    // If updateContent is requested, generate presigned upload URL
    let uploadUrl: string | undefined;
    if (updates.updateContent) {
      const putCommand = new PutObjectCommand({
        Bucket: file.data.bucket,
        Key: file.data.key,
        ContentType: "application/gpx+xml",
      });
      uploadUrl = await getSignedUrl(s3Client, putCommand, {
        expiresIn: 3600,
      });
    }

    const result = await GpxFile.update({
      userId: targetUserId,
      fileId: id,
    })
      .set(filteredUpdates)
      .go({ response: "all_new" });

    const response: { file: typeof result.data; uploadUrl?: string } = {
      file: result.data,
    };
    if (uploadUrl) {
      response.uploadUrl = uploadUrl;
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
