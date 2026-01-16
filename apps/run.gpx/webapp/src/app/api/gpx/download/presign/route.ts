import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign } from "@/lib/s3-client";
import { GpxFile } from "@/entities/gpx-file";

/**
 * Build versioned S3 key from base key
 * Base key: uploads/{userId}/gpx/{fileId}.gpx
 * Versioned: uploads/{userId}/gpx/{fileId}.v{version}.gpx
 */
function getVersionedKey(baseKey: string, version: number): string {
  // Replace .gpx extension with .v{version}.gpx
  return baseKey.replace(/\.gpx$/, `.v${version}.gpx`);
}

/**
 * POST /api/gpx/download/presign - Get presigned GET URL for direct S3 download
 *
 * Request body:
 *   - fileId: string (required) - The file to download
 *   - version?: number (optional) - Specific version to download
 *
 * If version is provided, downloads the specific version.
 * If version is not provided, downloads the current (latest) version.
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
    const { fileId, version } = await request.json();

    if (!fileId) {
      return NextResponse.json(
        { error: "fileId is required" },
        { status: 400 }
      );
    }

    // Validate version parameter if provided
    if (version !== undefined) {
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        return NextResponse.json(
          { error: "version must be a positive integer" },
          { status: 400 }
        );
      }
    }

    // Get file metadata to verify ownership and get S3 key
    const result = await GpxFile.get({
      userId: session.user.id,
      fileId,
    }).go();

    if (!result.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Validate requested version exists
    if (version !== undefined && version > result.data.versionCount) {
      return NextResponse.json(
        { error: `Version ${version} does not exist. Latest version is ${result.data.versionCount}` },
        { status: 404 }
      );
    }

    // Determine the S3 key to use
    // If version is specified, use versioned key; otherwise use current (non-versioned) key
    const s3Key = version !== undefined
      ? getVersionedKey(result.data.key, version)
      : result.data.key;

    const command = new GetObjectCommand({
      Bucket: result.data.bucket,
      Key: s3Key,
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
