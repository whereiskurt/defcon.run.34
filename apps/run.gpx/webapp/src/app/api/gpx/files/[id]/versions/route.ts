import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, getUserPrefix } from "@/lib/s3-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/gpx/files/[id]/versions - List all available versions of a file
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

    const file = result.data;
    const versionCount = file.versionCount || 1;
    const currentVersion = file.version || 1;

    // Check existence of each version in S3
    const versionChecks = [];
    for (let v = 1; v <= versionCount; v++) {
      const versionKey = `${getUserPrefix(targetUserId)}${id}.v${v}.gpx`;
      versionChecks.push(
        checkVersionExists(file.bucket, versionKey).then((exists) => ({
          version: v,
          exists,
        }))
      );
    }

    const versions = await Promise.all(versionChecks);

    return NextResponse.json({
      versions,
      current: currentVersion,
    });
  } catch (error) {
    console.error("Error getting GPX file versions:", error);
    return NextResponse.json(
      { error: "Failed to get file versions" },
      { status: 500 }
    );
  }
}

/**
 * Check if an S3 object exists using HeadObject (faster than GetObject)
 */
async function checkVersionExists(
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    // NotFound error means the object doesn't exist
    if ((error as { name?: string }).name === "NotFound") {
      return false;
    }
    // For other errors, log and assume not exists
    console.error(`Error checking version at ${key}:`, error);
    return false;
  }
}
