import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { GpxShare } from "@/entities/gpx-share";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { s3Client, s3ClientForPresign, getUserPrefix, BUCKET } from "@/lib/s3-client";
import { consumeQuota, restoreQuota } from "@/lib/quota-client";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isConDay, isValidDateString } from "@/lib/con-days";
import { conDayLimit, conDayRemaining, isConDayCapped } from "@/lib/con-day-quota";
import { countConDayRuns } from "@/lib/con-day-usage";
import { reconcileBestEffort } from "@/lib/gpx-reconcile";
import type { QuotaTier } from "@/lib/quota-client";

const MAX_VERSIONS = 50;

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
      userId: targetUserId,
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
 * PUT /api/gpx/files/[id] - Update file metadata or content
 * Request body can include:
 * - fileName, folderId (to move file), and other metadata
 * - updateContent: true to get a presigned URL for uploading new content
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
  let quotaConsumed = false;

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
    const updates = await request.json();

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

      // For global files, only uploader or admin can modify
      const isAdmin = services.includes("admin");
      if (file.data.uploadedBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the uploader or admin can modify this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Only allow updating specific fields
    const allowedFields = [
      "fileName",
      "fileSize",
      "trackCount",
      "waypointCount",
      "totalDistance",
      "totalElevation",
      "bounds",
      "folderId", // Allow moving files between folders
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Handle folderId: null means move to root (use "ROOT" sentinel)
        if (field === "folderId") {
          filteredUpdates[field] = updates[field] || "ROOT";
        } else {
          filteredUpdates[field] = updates[field];
        }
      }
    }

    // "Save as defcon.run Activity" (2026-07-21 spec): (re)assign the con-day
    // tag on the runner's own file. ANY con day is choosable at any time (the
    // no-future gate deliberately does not apply here); admins may use any
    // valid date. Moving to a DIFFERENT day requires budget on the target day.
    let conDayRemainingAfter: number | undefined;
    let clearConDay = false;
    if (updates.conDay !== undefined) {
      if (targetUserId === "GLOBAL") {
        return NextResponse.json(
          { error: "Community files aren't day-tagged" },
          { status: 400 }
        );
      }
      const isAdmin = services.includes("admin");
      const tier: QuotaTier = isAdmin ? "admin" : "upload";
      if (updates.conDay === null) {
        clearConDay = true;
      } else if (typeof updates.conDay !== "string") {
        return NextResponse.json(
          { error: "Invalid conDay", message: "conDay must be a date string or null" },
          { status: 400 }
        );
      } else if (isAdmin ? !isValidDateString(updates.conDay) : !isConDay(updates.conDay)) {
        return NextResponse.json(
          { error: "Invalid conDay", message: "conDay must be a DEF CON run day" },
          { status: 400 }
        );
      } else {
        if (updates.conDay !== file.data.conDay) {
          const targetCount = await countConDayRuns(session.user.id, updates.conDay);
          if (isConDayCapped(targetCount, tier)) {
            return NextResponse.json(
              {
                error: "Con-day limit reached",
                message: `You've logged all ${conDayLimit(tier)} runs for that day`,
                conDay: updates.conDay,
                remaining: 0,
                limit: conDayLimit(tier),
              },
              { status: 429 }
            );
          }
          conDayRemainingAfter = conDayRemaining(targetCount + 1, tier);
        } else {
          conDayRemainingAfter = undefined; // same-day re-save: nothing changes
        }
        filteredUpdates.conDay = updates.conDay;
      }
    }

    // If updateContent is requested, generate presigned upload URL for a new version
    let uploadUrl: string | undefined;
    let newVersion: number | undefined;
    let versionedKey: string | undefined;

    if (updates.updateContent) {
      // Consume save quota before generating presign URL
      const quotaResult = await consumeQuota(session.user.id, "gpx_save", 1);
      if (!quotaResult.success) {
        return NextResponse.json(
          {
            error: "Save quota exceeded",
            message: "You have reached your save limit",
            remaining: quotaResult.remaining,
            quotaId: "gpx_save",
          },
          { status: 429 }
        );
      }
      quotaConsumed = true;

      // Calculate new version
      const currentVersion = file.data.version || 1;
      newVersion = currentVersion + 1;

      // Cap versionCount at MAX_VERSIONS
      const newVersionCount = Math.min(newVersion, MAX_VERSIONS);

      // Generate versioned S3 key: uploads/{userId}/gpx/{fileId}.v{version}.gpx
      // Use the appropriate userId prefix (either user's ID or GLOBAL)
      const prefix = getUserPrefix(targetUserId);
      versionedKey = `${prefix}${id}.v${newVersion}.gpx`;

      // Update version fields in filteredUpdates
      filteredUpdates.version = newVersion;
      filteredUpdates.versionCount = newVersionCount;

      // Prune oldest version if we exceeded MAX_VERSIONS
      if (newVersion > MAX_VERSIONS) {
        const versionToDelete = newVersion - MAX_VERSIONS;
        const keyToDelete = `${prefix}${id}.v${versionToDelete}.gpx`;
        await s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: keyToDelete,
        }));
      }

      const putCommand = new PutObjectCommand({
        Bucket: BUCKET,
        Key: versionedKey,
        ContentType: "application/gpx+xml",
      });
      // Use s3ClientForPresign to avoid checksum header issues with browser uploads
      uploadUrl = await getSignedUrl(s3ClientForPresign, putCommand, {
        expiresIn: 3600,
      });
    }

    if (clearConDay) {
      await GpxFile.update({
        userId: targetUserId,
        fileId: id,
      })
        .remove(["conDay"])
        .go();
    }

    const result = await GpxFile.update({
      userId: targetUserId,
      fileId: id,
    })
      .set(filteredUpdates)
      .go({ response: "all_new" });

    // Task 4 (leaderboard<->runs reconcile): a con-day (re)tag changes this
    // runner's live con-day-tagged run set, so re-converge run.human's
    // Accomplishment rows. Fire-and-forget (T-50-06); community files have no
    // individual owner and are excluded above (conDay updates 400 on GLOBAL).
    if (updates.conDay !== undefined && targetUserId !== "GLOBAL") {
      reconcileBestEffort(session.user.id);
    }

    const response: {
      file: typeof result.data;
      uploadUrl?: string;
      version?: number;
      versionedKey?: string;
      conDayRemaining?: number;
    } = {
      file: result.data,
    };
    if (uploadUrl) {
      response.uploadUrl = uploadUrl;
      response.version = newVersion;
      response.versionedKey = versionedKey;
    }
    if (conDayRemainingAfter !== undefined) {
      response.conDayRemaining = conDayRemainingAfter;
    }

    return NextResponse.json(response);
  } catch (error) {
    // Restore quota if consumed and operation failed
    if (quotaConsumed) {
      await restoreQuota(session.user.id, "gpx_save", 1).catch(() => {});
    }
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

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

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

      // For global files, only uploader or admin can delete
      const isAdmin = services.includes("admin");
      if (file.data.uploadedBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the uploader or admin can delete this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Delete all shares associated with this file (cascade delete)
    const shares = await GpxShare.query
      .byFile({ ownerId: targetUserId, fileId: id })
      .go();

    for (const share of shares.data) {
      await GpxShare.delete({ shareId: share.shareId }).go();
    }

    // Delete from S3
    const deleteCommand = new DeleteObjectCommand({
      Bucket: file.data.bucket,
      Key: file.data.key,
    });
    await s3Client.send(deleteCommand);

    // Delete from DynamoDB
    await GpxFile.delete({
      userId: targetUserId,
      fileId: id,
    }).go();

    // Task 4 (leaderboard<->runs reconcile): a deleted run may have been
    // con-day tagged, so re-converge run.human's Accomplishment rows.
    // Fire-and-forget (T-50-06); GLOBAL community files have no individual
    // owner and must not score.
    if (targetUserId !== "GLOBAL") {
      reconcileBestEffort(targetUserId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting GPX file:", error);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gpx/files/[id] - Finalize version upload by copying versioned file to current key
 * Request body:
 * - versionedKey: The S3 key of the uploaded versioned file
 *
 * This should be called after successfully uploading to the presigned URL returned by PUT
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

  const { id } = await params;

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
    const { versionedKey } = await request.json();

    if (!versionedKey) {
      return NextResponse.json(
        { error: "versionedKey is required" },
        { status: 400 }
      );
    }

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

      // For global files, only uploader or admin can modify
      const isAdmin = services.includes("admin");
      if (file.data.uploadedBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the uploader or admin can modify this file" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Validate that the versionedKey is for this file
    const expectedPrefix = `${getUserPrefix(targetUserId)}${id}.v`;
    if (!versionedKey.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: "Invalid versionedKey for this file" },
        { status: 400 }
      );
    }

    // Copy the versioned file to the current (non-versioned) key
    const copyCommand = new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${versionedKey}`,
      Key: file.data.key,
      ContentType: "application/gpx+xml",
    });

    await s3Client.send(copyCommand);

    return NextResponse.json({
      success: true,
      file: file.data,
    });
  } catch (error) {
    console.error("Error finalizing GPX file version:", error);
    return NextResponse.json(
      { error: "Failed to finalize version" },
      { status: 500 }
    );
  }
}
