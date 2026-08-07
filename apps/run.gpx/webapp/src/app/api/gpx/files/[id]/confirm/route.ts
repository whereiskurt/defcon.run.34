import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { validateGpxFile } from "@/lib/gpx-validator";
import { summarizeUploadedGpx } from "@/lib/route-summary";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { reconcileBestEffort } from "@/lib/gpx-reconcile";

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

    // Validation passed — derive the geometry from the bytes, then activate.
    //
    // WHY HERE. `POST /api/gpx/files` takes trackCount/totalDistance/
    // totalElevation from the CLIENT request body and defaults them to 0, and
    // nothing downstream ever corrected them. The studio does not send a
    // distance, so every hand-uploaded run stored `totalDistance: 0` and no
    // bounds at all — 10 of the 71 con-day runs on 2026-08-07, which is exactly
    // the set that reads as "—" on /admin/heatmap and on the PUBLIC maps route.
    //
    // `lib/route-summary.ts` already derived this server-side for Route
    // templates ("the client NEVER supplies geometry metadata for a route");
    // that hardening simply never reached GpxFile. This is the same call.
    //
    // The leaderboard was never affected: `gpx-reconcile.ts` re-parses the S3
    // object with `parseTrack` and never reads these attributes. Nothing here
    // changes anyone's score.
    //
    // BEST-EFFORT ON PURPOSE. The file has already passed validation and the
    // user's upload is complete; a summary that fails or is too large to read
    // honestly (null — see summarizeUploadedGpx) must not fail the confirm.
    // In that case the stored values are left alone rather than zeroed, so a
    // gap stays a visible gap instead of becoming a confident wrong number.
    let geometry: {
      trackCount?: number;
      waypointCount?: number;
      totalDistance?: number;
      totalElevation?: number;
      bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    } = {};
    try {
      const summary = await summarizeUploadedGpx(file.data.key);
      if (summary) {
        geometry = {
          trackCount: summary.trackCount,
          waypointCount: summary.waypointCount,
          totalDistance: summary.totalDistance,
          totalElevation: summary.totalElevation,
          // OMIT for a trackless file: `summarizeGpxText` returns undefined
          // bounds when there are no points, and writing a degenerate box map
          // consumers would try to fit to is worse than writing none.
          ...(summary.bounds ? { bounds: summary.bounds } : {}),
        };
      } else {
        console.warn(`[confirm] ${id}: too large to summarize; geometry left as-is`);
      }
    } catch (summaryError) {
      console.error(`[confirm] ${id}: geometry summary failed:`, summaryError);
    }

    const result = await GpxFile.update({
      userId: targetUserId,
      fileId: id,
    })
      .set({ status: "active", ...geometry })
      .go({ response: "all_new" });

    // LDBR-05 / Task 4 (leaderboard<->runs reconcile): turn an individually-owned
    // GPX activation into a full-recalc reconcile against run.human's
    // Accomplishment rows. Fire-and-forget — ANY failure is swallowed inside
    // reconcileBestEffort so the confirm success response and the user's save
    // always succeed (T-50-06). GLOBAL community files have no individual owner
    // and must NOT score (T-50-07).
    if (targetUserId !== "GLOBAL") {
      reconcileBestEffort(file.data.userId);
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
