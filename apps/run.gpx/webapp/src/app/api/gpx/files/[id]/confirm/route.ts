import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { validateGpxFile } from "@/lib/gpx-validator";
import { assertNotLockedLive } from "@/lib/live-lockout";
import {
  parseTrack,
  buildAccomplishmentPayload,
  notifyAccomplishment,
} from "@/lib/gpx-accomplishment";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/confirm - Confirm upload and validate GPX content
 *
 * This endpoint should be called after uploading the file to S3.
 * It validates the file is a valid GPX and activates the record.
 *
 * If validation fails:
 *   - S3 object is deleted
 *   - DynamoDB record is marked as failed
 *   - Quota is NOT restored (invalid uploads count against quota to prevent abuse)
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

      // For global files, only uploader can confirm
      if (file.data.uploadedBy !== session.user.id) {
        return NextResponse.json(
          { error: "Only the uploader can confirm this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Check file is in pending status
    if (file.data.status !== "pending") {
      if (file.data.status === "active") {
        // Already confirmed, just return success
        return NextResponse.json({
          success: true,
          file: file.data,
          message: "File already confirmed",
        });
      }
      return NextResponse.json(
        { error: `Cannot confirm file with status: ${file.data.status}` },
        { status: 400 }
      );
    }

    // Validate the GPX file content
    const validationResult = await validateGpxFile(file.data.key);

    if (!validationResult.valid) {
      // Validation failed - clean up
      console.log(
        `[confirm] Validation failed for ${id}: ${validationResult.error}`
      );

      // Delete from S3
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: file.data.key,
          })
        );
      } catch (s3Error) {
        console.error("[confirm] Failed to delete S3 object:", s3Error);
      }

      // Update status to failed
      await GpxFile.update({
        userId: targetUserId,
        fileId: id,
      })
        .set({ status: "failed" })
        .go();

      // Note: Quota is intentionally NOT restored for invalid uploads
      // This prevents malicious actors from repeatedly uploading garbage

      return NextResponse.json(
        {
          error: "Invalid GPX file",
          message: validationResult.error,
          quotaConsumed: true, // Invalid uploads still count against quota
        },
        { status: 400 }
      );
    }

    // Validation passed - activate the file
    const result = await GpxFile.update({
      userId: targetUserId,
      fileId: id,
    })
      .set({ status: "active" })
      .go({ response: "all_new" });

    // LDBR-05: turn an individually-owned GPX activation into a leaderboard
    // accomplishment on run.human. Best-effort / fire-and-forget — ANY failure
    // here (S3 fetch, parse, POST) is swallowed so the confirm success response
    // and the user's save always succeed (T-50-06). GLOBAL community files have
    // no individual owner and must NOT score (T-50-07).
    if (targetUserId !== "GLOBAL") {
      try {
        // Full body (no Range header) — the 1KB validator above is separate.
        const obj = await s3Client.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: file.data.key })
        );
        const gpxText = (await obj.Body?.transformToString()) ?? "";
        const { points, distance, elevation } = parseTrack(gpxText);
        // run.gpx is pure JWT: GpxFile.userId IS the raw OIDC sub run.human wants.
        const payload = buildAccomplishmentPayload({
          oidcSub: file.data.userId,
          gpxFileId: id,
          name: file.data.fileName,
          points,
          distance,
          elevation,
          completedAt: Date.now(),
        });
        await notifyAccomplishment(payload);
      } catch (err) {
        // gpxFileId only — never the secret or payload (T-50-08).
        console.log(
          `[confirm] accomplishment notify skipped for ${id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return NextResponse.json({
      success: true,
      file: result.data,
    });
  } catch (error) {
    console.error("Error confirming GPX file:", error);
    return NextResponse.json(
      { error: "Failed to confirm file" },
      { status: 500 }
    );
  }
}
