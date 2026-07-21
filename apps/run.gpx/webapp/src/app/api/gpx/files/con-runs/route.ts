import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "@/lib/s3-client";

/**
 * GET /api/gpx/files/con-runs — manifest for the "My DEF CON Runs" overlay
 * (2026-07-21 spec). The signed-in runner's ACTIVE files that carry a conDay
 * tag, each with a presigned GPX download URL so the studio can render them as
 * a read-only layer grouped by day. Own files only; ≤10/day × 6 days keeps this
 * a single-partition read.
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
      .go({ pages: "all", order: "desc" });

    const tagged = result.data.filter(
      (f) => !!f.conDay && (!f.status || f.status === "active")
    );

    const runs = await Promise.all(
      tagged.map(async (f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        conDay: f.conDay as string,
        totalDistance: f.totalDistance,
        bounds: f.bounds,
        downloadUrl: await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: f.bucket, Key: f.key }),
          { expiresIn: 3600 }
        ),
      }))
    );

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("con-runs manifest failed:", error);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 500 });
  }
}
