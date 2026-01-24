import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxShare } from "@/entities/gpx-share";
import { GpxFile } from "@/entities/gpx-file";
import { nanoid } from "nanoid";
import { consumeQuota, restoreQuota } from "@/lib/quota-client";

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

    // Construct the share URL
    // Local: http://localhost:3003/studio/share/{token}
    // Prod: https://gpx.defcon.run/{region}/studio/share/{token}
    const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    const isProduction = configuredBaseUrl?.includes("defcon.run");

    let shareUrl: string;
    if (isProduction) {
      // Production: use domain with region prefix
      const regionShort = process.env.REGION_SHORT || "use1";
      shareUrl = `${configuredBaseUrl}/${regionShort}/studio/share/${shareId}`;
    } else {
      // Local development: no region prefix, use configured URL or localhost
      const baseUrl = configuredBaseUrl || `http://localhost:${process.env.PORT || "3003"}`;
      shareUrl = `${baseUrl}/studio/share/${shareId}`;
    }

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

    // Construct share URLs for each share
    const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    const isProduction = configuredBaseUrl?.includes("defcon.run");
    const regionShort = process.env.REGION_SHORT || "use1";

    const shares = result.data.map((share) => {
      let shareUrl: string;
      if (isProduction) {
        shareUrl = `${configuredBaseUrl}/${regionShort}/studio/share/${share.shareId}`;
      } else {
        const baseUrl = configuredBaseUrl || `http://localhost:${process.env.PORT || "3003"}`;
        shareUrl = `${baseUrl}/studio/share/${share.shareId}`;
      }
      return { ...share, shareUrl };
    });

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Error listing shares:", error);
    return NextResponse.json(
      { error: "Failed to list shares" },
      { status: 500 }
    );
  }
}
