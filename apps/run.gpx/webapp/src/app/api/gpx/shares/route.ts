import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxShare } from "@/entities/gpx-share";
import { GpxFile } from "@/entities/gpx-file";
import { nanoid } from "nanoid";
import { consumeQuota, restoreQuota } from "@/lib/quota-client";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { buildShareUrl } from "@/lib/share-url";

/**
 * POST /api/gpx/shares - Create a new share link for a GPX file
 * Request body:
 *   - fileId (required) - ID of the file to share
 *   - version (required) - Version number to share
 *   - accessMode (required) - "public" or "private"
 *   - allowedEmails (optional) - Array of emails for private shares
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
    const { fileId, version, accessMode, allowedEmails } = await request.json();

    // Validate required fields
    if (!fileId) {
      return NextResponse.json(
        { error: "fileId is required" },
        { status: 400 }
      );
    }

    if (version === undefined || version === null) {
      return NextResponse.json(
        { error: "version is required" },
        { status: 400 }
      );
    }

    if (!accessMode || !["public", "private"].includes(accessMode)) {
      return NextResponse.json(
        { error: "accessMode must be 'public' or 'private'" },
        { status: 400 }
      );
    }

    // For private shares, require allowedEmails
    if (accessMode === "private" && (!allowedEmails || allowedEmails.length === 0)) {
      return NextResponse.json(
        { error: "allowedEmails is required for private shares" },
        { status: 400 }
      );
    }

    // Verify the user owns this file
    let fileResult = await GpxFile.get({
      userId: session.user.id,
      fileId,
    }).go();

    if (!fileResult.data) {
      // Also check GLOBAL files where user is the uploader
      const globalResult = await GpxFile.get({
        userId: "GLOBAL",
        fileId,
      }).go();

      if (!globalResult.data || globalResult.data.uploadedBy !== session.user.id) {
        return NextResponse.json(
          { error: "File not found or access denied" },
          { status: 404 }
        );
      }
      fileResult = globalResult;
    }

    // Validate version exists (data is guaranteed non-null after checks above)
    const maxVersion = fileResult.data!.versionCount || 1;
    if (version < 1 || version > maxVersion) {
      return NextResponse.json(
        { error: `Invalid version. File has versions 1-${maxVersion}` },
        { status: 400 }
      );
    }

    // Consume share quota
    const quotaResult = await consumeQuota(session.user.id, "gpx_share", 1);
    if (!quotaResult.success) {
      return NextResponse.json(
        {
          error: "Share quota exceeded",
          details: {
            remaining: quotaResult.remaining,
            quotaId: "gpx_share",
          },
        },
        { status: 429 }
      );
    }

    // Generate a unique share ID
    const shareId = nanoid(21);

    // Normalize emails to lowercase for case-insensitive comparison
    const normalizedEmails = accessMode === "private"
      ? allowedEmails.map((e: string) => e.toLowerCase().trim())
      : undefined;

    // Create the share record
    try {
      await GpxShare.create({
        shareId,
        ownerId: session.user.id,
        fileId,
        version,
        accessMode,
        allowedEmails: normalizedEmails,
      }).go();
    } catch (createError) {
      // Restore quota if share creation fails
      await restoreQuota(session.user.id, "gpx_share", 1).catch(() => {});
      throw createError;
    }

    return NextResponse.json({ shareId, shareUrl: buildShareUrl(shareId) });
  } catch (error) {
    console.error("Error creating share:", error);
    return NextResponse.json(
      { error: "Failed to create share" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gpx/shares - List shares for a file
 * Query params:
 *   - fileId (required) - ID of the file to list shares for
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");
  const listAll = searchParams.get("all") === "true";

  try {
    let result;

    if (listAll) {
      // List all shares for the current user (uses scan - for cleanup/admin only)
      // Note: This is less efficient than index query but needed for cleanup
      result = await GpxShare.scan
        .where(({ ownerId }, { eq }) => eq(ownerId, userId))
        .go();
    } else if (fileId) {
      // Query shares by ownerId and fileId using the byFile index
      result = await GpxShare.query
        .byFile({ ownerId: userId, fileId })
        .go({ order: "desc" });
    } else {
      return NextResponse.json(
        { error: "Either fileId or all=true query parameter is required" },
        { status: 400 }
      );
    }

    // Construct share URLs for each share
    const shares = result.data.map((share) => ({
      ...share,
      shareUrl: buildShareUrl(share.shareId),
    }));

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Error listing shares:", error);
    return NextResponse.json(
      { error: "Failed to list shares" },
      { status: 500 }
    );
  }
}
