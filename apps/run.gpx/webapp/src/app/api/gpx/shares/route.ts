import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxShare } from "@/entities/gpx-share";
import { GpxFile } from "@/entities/gpx-file";
import { nanoid } from "nanoid";

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
    const fileResult = await GpxFile.get({
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
    }

    // Generate a unique share ID
    const shareId = nanoid(21);

    // Create the share record
    await GpxShare.create({
      shareId,
      ownerId: session.user.id,
      fileId,
      version,
      accessMode,
      allowedEmails: accessMode === "private" ? allowedEmails : undefined,
    }).go();

    // Construct the share URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://gpx.defcon.run";
    const shareUrl = `${baseUrl}/share/${shareId}`;

    return NextResponse.json({ shareId, shareUrl });
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

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  if (!fileId) {
    return NextResponse.json(
      { error: "fileId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Query shares by ownerId and fileId using the byFile index
    const result = await GpxShare.query
      .byFile({ ownerId: session.user.id, fileId })
      .go({ order: "desc" });

    const shares = result.data;

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Error listing shares:", error);
    return NextResponse.json(
      { error: "Failed to list shares" },
      { status: 500 }
    );
  }
}
