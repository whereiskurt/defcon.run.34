import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { v4 as uuidv4 } from "uuid";
import { getMaxFileSize, PRESIGN_EXPIRY_SECONDS } from "@/lib/constants";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import { logEvent } from "@/lib/log-event";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isConDay, isSelectableConDay } from "@/lib/con-days";
import { conDayLimit, conDayRemaining, isConDayCapped } from "@/lib/con-day-quota";
import { countConDayRuns } from "@/lib/con-day-usage";

/**
 * GET /api/gpx/files - List user's GPX files
 * Query params:
 *   - folderId (optional) - Filter by folder. Omit or "root" for root level files.
 *   - global (optional) - If "true", list files from global context
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  const isGlobal = searchParams.get("global") === "true";
  const targetUserId = isGlobal ? "GLOBAL" : session.user.id;

  try {
    // Use "ROOT" as sentinel value for root-level files
    const targetFolderId = (folderId && folderId !== "root") ? folderId : "ROOT";

    const result = await GpxFile.query
      .byFolder({ userId: targetUserId, folderId: targetFolderId })
      .go({ order: "desc" });

    // Filter to only show active files (not pending or failed)
    // Note: status defaults to "active" for backwards compatibility with existing files
    const files = result.data.filter(
      (file: { status?: string }) => !file.status || file.status === "active"
    );

    return NextResponse.json({ files });
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
 * Request body:
 *   - fileName (required)
 *   - fileSize (required for quota/size validation)
 *   - folderId (optional) - Folder to save to
 *   - trackCount, waypointCount, totalDistance, totalElevation (optional metadata)
 *
 * Security controls:
 *   - File size limit: 20 MB (upload tier), 100 MB (admin tier)
 *   - Quota: 10 uploads (upload tier), 100 uploads (admin tier)
 *   - File created with status: 'pending' until confirmed via /confirm endpoint
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

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
    const {
      fileName,
      fileSize,
      folderId,
      trackCount,
      waypointCount,
      totalDistance,
      totalElevation,
      conDay,
    } = await request.json();

    if (!fileName) {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 }
      );
    }

    // Con-day tag (Phase 58): optional, but when provided it must be a real con
    // day and not in the future (you can't log a run that hasn't happened).
    // Invalid/future values are rejected rather than silently dropped so the
    // client can correct the picker.
    if (conDay !== undefined && conDay !== null) {
      if (typeof conDay !== "string" || !isConDay(conDay)) {
        return NextResponse.json(
          { error: "Invalid conDay", message: "conDay must be a DEF CON run day" },
          { status: 400 }
        );
      }
      if (!isSelectableConDay(conDay, Date.now())) {
        return NextResponse.json(
          {
            error: "conDay in the future",
            message: "You can't log a run for a day that hasn't happened yet",
          },
          { status: 400 }
        );
      }
    }

    // Determine quota tier based on services (needed for tier-specific limits)
    const quotaTier: QuotaTier = services.includes("admin") ? "admin" : "upload";
    const maxFileSize = getMaxFileSize(quotaTier);

    // Per-con-day cap (Phase 59): at most N runs tagged to a single con-day.
    // Checked BEFORE the lifetime gpx_upload quota is consumed so a capped day
    // never burns lifetime budget. Count-based (keyed on the con-day, not the
    // upload date) so day-4 catch-up works. Best-effort read-then-check — the
    // atomic gpx_upload quota below is the hard abuse wall.
    let conDayCountBefore = 0;
    if (conDay) {
      conDayCountBefore = await countConDayRuns(session.user.id, conDay);
      if (isConDayCapped(conDayCountBefore, quotaTier)) {
        return NextResponse.json(
          {
            error: "Con-day limit reached",
            message: `You've logged all ${conDayLimit(
              quotaTier
            )} runs for this day`,
            conDay,
            remaining: 0,
            limit: conDayLimit(quotaTier),
          },
          { status: 429 }
        );
      }
    }

    // Security: Validate file size against tier-specific limit
    if (fileSize && fileSize > maxFileSize) {
      return NextResponse.json(
        {
          error: "File too large",
          message: `Maximum file size is ${maxFileSize / (1024 * 1024)} MB`,
          maxSize: maxFileSize,
          requestedSize: fileSize,
        },
        { status: 413 }
      );
    }

    // Security: Consume quota before generating presign URL
    const quotaResult = await consumeQuota(
      session.user.id,
      "gpx_upload",
      1,
      quotaTier
    );

    if (!quotaResult.success) {
      return NextResponse.json(
        {
          error: "Quota exceeded",
          message: "You have reached your upload limit",
          remaining: quotaResult.remaining,
          quotaId: "gpx_upload",
        },
        { status: 429 }
      );
    }

    // Determine if saving to a global folder
    let targetUserId = session.user.id;
    let isGlobalFolder = false;
    let validatedFolderId = "ROOT"; // Default to ROOT

    if (folderId) {
      // Check if this is a global folder
      const { GpxFolder } = await import("@/entities/gpx-folder");

      // Try user folder first
      let folder = await GpxFolder.get({
        userId: session.user.id,
        folderId,
      }).go();

      if (folder.data) {
        validatedFolderId = folderId;
      } else {
        // Check global folder
        folder = await GpxFolder.get({
          userId: "GLOBAL",
          folderId,
        }).go();

        if (folder.data) {
          isGlobalFolder = true;
          targetUserId = "GLOBAL";
          validatedFolderId = folderId;
        }
        // If folder not found, validatedFolderId remains ROOT
        // This handles stale folder references from client state
      }
    }

    // Security: only admins can add files to GLOBAL shared folders.
    if (isGlobalFolder && !services.includes("admin")) {
      await restoreQuota(session.user.id, "gpx_upload", 1);
      return NextResponse.json(
        { error: "Only admins can add files to shared folders" },
        { status: 403 }
      );
    }

    const fileId = uuidv4();
    const key = `${getUserPrefix(targetUserId)}${fileId}.gpx`;

    // Generate presigned upload URL with ContentLength constraint
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "application/gpx+xml",
      // Enforce file size at S3 level if provided
      ...(fileSize ? { ContentLength: fileSize } : {}),
    });

    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(s3ClientForPresign, command, {
        expiresIn: PRESIGN_EXPIRY_SECONDS,
      });
    } catch (presignError) {
      // Restore quota if presign fails
      await restoreQuota(session.user.id, "gpx_upload", 1);
      throw presignError;
    }

    // Create DynamoDB record with pending status
    try {
      await GpxFile.create({
        userId: targetUserId,
        fileId,
        fileName,
        bucket: BUCKET,
        key,
        fileSize: fileSize || 0,
        folderId: validatedFolderId,
        trackCount: trackCount || 0,
        waypointCount: waypointCount || 0,
        totalDistance: totalDistance || 0,
        totalElevation: totalElevation || 0,
        uploadedBy: isGlobalFolder ? session.user.id : undefined,
        // Con-day tag (Phase 58). GLOBAL community files are not day-tagged.
        conDay: !isGlobalFolder && conDay ? conDay : undefined,
        status: "pending", // Pending until confirmed
      }).go();
    } catch (dbError) {
      // Restore quota if DB write fails
      await restoreQuota(session.user.id, "gpx_upload", 1);
      throw dbError;
    }

    // Activity signal (AR-02): a new route was created. Fire-and-forget.
    logEvent("gpx.file.create", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { fileId },
    });

    return NextResponse.json({
      uploadUrl,
      fileId,
      key,
      quotaRemaining: quotaResult.remaining,
      // Per-con-day budget left AFTER this run (Phase 59), so the card can show
      // "N of 10 · Sat" without a second round-trip. Only when day-tagged.
      ...(conDay
        ? { conDayRemaining: conDayRemaining(conDayCountBefore + 1, quotaTier) }
        : {}),
    });
  } catch (error) {
    console.error("Error creating GPX file:", error);
    return NextResponse.json(
      { error: "Failed to create file" },
      { status: 500 }
    );
  }
}
