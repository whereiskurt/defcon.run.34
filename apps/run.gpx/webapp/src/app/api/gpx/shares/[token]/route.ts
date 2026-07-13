import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxShare } from "@/entities/gpx-share";
import { GpxFile } from "@/entities/gpx-file";
import { assertNotLockedLive } from "@/lib/live-lockout";

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/gpx/shares/[token] - Validate share and get metadata
 * - If accessMode is "private": requires authentication and email in allowedEmails
 * - If accessMode is "public": authentication optional for viewing metadata
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { token } = await params;

  try {
    // Look up share by shareId (token)
    const shareResult = await GpxShare.get({
      shareId: token,
    }).go();

    if (!shareResult.data) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const share = shareResult.data;

    // Check if share has expired
    if (share.expiresAt && share.expiresAt < Date.now()) {
      return NextResponse.json({ error: "Share has expired" }, { status: 404 });
    }

    // For private shares, require authentication and check allowedEmails
    // Return 404 for all failures to avoid revealing that a valid private share exists
    if (share.accessMode === "private") {
      const session = await auth();
      const userEmail = session?.user?.email?.toLowerCase();
      const normalizedAllowed = (share.allowedEmails || []).map(e => e.toLowerCase());

      if (!userEmail || !normalizedAllowed.includes(userEmail)) {
        // Don't distinguish between "not authenticated" and "not in allowed list"
        // to prevent enumeration of valid private share tokens
        return NextResponse.json({ error: "Share not found" }, { status: 404 });
      }
    }

    // Get file metadata
    // First try owner's files, then try GLOBAL
    let fileResult = await GpxFile.get({
      userId: share.ownerId,
      fileId: share.fileId,
    }).go();

    if (!fileResult.data) {
      fileResult = await GpxFile.get({
        userId: "GLOBAL",
        fileId: share.fileId,
      }).go();
    }

    // Build response
    const response: {
      share: {
        shareId: string;
        fileId: string;
        version: number;
        accessMode: "public" | "private";
        createdAt: number;
      };
      file: {
        fileName: string;
        trackCount: number;
        totalDistance: number;
      } | null;
    } = {
      share: {
        shareId: share.shareId,
        fileId: share.fileId,
        version: share.version,
        accessMode: share.accessMode,
        createdAt: share.createdAt,
      },
      file: fileResult.data
        ? {
            fileName: fileResult.data.fileName,
            trackCount: fileResult.data.trackCount || 0,
            totalDistance: fileResult.data.totalDistance || 0,
          }
        : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error validating share:", error);
    return NextResponse.json(
      { error: "Failed to validate share" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gpx/shares/[token] - Revoke/delete share
 * - Requires authentication
 * - Caller must be the share owner (ownerId matches session userId)
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { token } = await params;

  try {
    // Look up share by shareId
    const shareResult = await GpxShare.get({
      shareId: token,
    }).go();

    if (!shareResult.data) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const share = shareResult.data;

    // Verify caller is the owner
    if (share.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the share owner can delete this share" },
        { status: 403 }
      );
    }

    // Delete the share record
    await GpxShare.delete({
      shareId: token,
    }).go();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting share:", error);
    return NextResponse.json(
      { error: "Failed to delete share" },
      { status: 500 }
    );
  }
}
