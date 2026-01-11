import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
    const result = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();

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
      userId: session.user.id,
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
 * PUT /api/gpx/files/[id] - Update file metadata
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

    // Only allow updating specific fields
    const allowedFields = [
      "fileName",
      "fileSize",
      "trackCount",
      "waypointCount",
      "totalDistance",
      "totalElevation",
      "bounds",
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    const result = await GpxFile.update({
      userId: session.user.id,
      fileId: id,
    })
      .set(filteredUpdates)
      .go({ response: "all_new" });

    return NextResponse.json({ file: result.data });
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
    // Get file metadata first
    const result = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();

    if (!result.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Delete from S3
    const deleteCommand = new DeleteObjectCommand({
      Bucket: result.data.bucket,
      Key: result.data.key,
    });
    await s3Client.send(deleteCommand);

    // Delete from DynamoDB
    await GpxFile.delete({
      userId: session.user.id,
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
