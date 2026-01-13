import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";

/**
 * GET /api/gpx/files - List user's GPX files
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const result = await GpxFile.query
      .byCreatedAt({ userId: session.user.id })
      .go({ order: "desc" });

    return NextResponse.json({ files: result.data });
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
    const { fileName, fileSize } = await request.json();

    if (!fileName) {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 }
      );
    }

    const fileId = uuidv4();
    const key = `${getUserPrefix(session.user.id)}${fileId}.gpx`;

    // Generate presigned upload URL
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "application/gpx+xml",
    });

    const uploadUrl = await getSignedUrl(s3ClientForPresign, command, { expiresIn: 3600 });

    // Create DynamoDB record
    await GpxFile.create({
      userId: session.user.id,
      fileId,
      fileName,
      bucket: BUCKET,
      key,
      fileSize: fileSize || 0,
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
