import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign } from "@/lib/s3-client";
import { GpxFile } from "@/entities/gpx-file";

/**
 * POST /api/gpx/download/presign - Get presigned GET URL for direct S3 download
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
    const { fileId } = await request.json();

    if (!fileId) {
      return NextResponse.json(
        { error: "fileId is required" },
        { status: 400 }
      );
    }

    // Get file metadata to verify ownership and get S3 key
    const result = await GpxFile.get({
      userId: session.user.id,
      fileId,
    }).go();

    if (!result.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: result.data.bucket,
      Key: result.data.key,
    });

    const downloadUrl = await getSignedUrl(s3ClientForPresign, command, {
      expiresIn: 3600,
    });

    return NextResponse.json({
      downloadUrl,
      fileName: result.data.fileName,
    });
  } catch (error) {
    console.error("Error generating presigned download URL:", error);
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }
}
