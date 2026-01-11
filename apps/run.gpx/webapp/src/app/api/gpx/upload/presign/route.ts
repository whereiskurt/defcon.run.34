import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/gpx/upload/presign - Get presigned PUT URL for direct S3 upload
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
    const { fileName, contentType } = await request.json();

    const fileId = uuidv4();
    const extension = fileName?.endsWith(".gpx") ? "" : ".gpx";
    const key = `${getUserPrefix(session.user.id)}${fileId}${extension}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType || "application/gpx+xml",
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return NextResponse.json({
      uploadUrl,
      fileId,
      key,
      bucket: BUCKET,
    });
  } catch (error) {
    console.error("Error generating presigned upload URL:", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
