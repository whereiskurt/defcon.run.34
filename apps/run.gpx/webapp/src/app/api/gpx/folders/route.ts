import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFolder, GpxFolderItem, FOLDER_LIMITS } from "@/entities/gpx-folder";
import { GpxFile } from "@/entities/gpx-file";
import { v4 as uuidv4 } from "uuid";

/**
 * GET /api/gpx/folders - List folders in a parent folder
 * Query params:
 *   - parentId (optional) - Parent folder ID. Omit for root level.
 *   - includeGlobal (optional) - If "true", also return global folders
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
  const parentId = searchParams.get("parentId") || undefined;
  const includeGlobal = searchParams.get("includeGlobal") === "true";

  try {
    // Use "ROOT" sentinel for root-level folders
    const targetParentId = parentId || "ROOT";

    // Query folders for this user with parent filter
    const userResult = await GpxFolder.query
      .byParent({ userId: session.user.id, parentFolderId: targetParentId })
      .go();
    const userFolders = userResult.data;

    // Optionally include global folders
    let globalFolders: GpxFolderItem[] = [];
    if (includeGlobal) {
      const globalResult = await GpxFolder.query
        .byParent({ userId: "GLOBAL", parentFolderId: targetParentId })
        .go();
      globalFolders = globalResult.data;
    }

    return NextResponse.json({
      folders: userFolders,
      globalFolders: includeGlobal ? globalFolders : undefined,
    });
  } catch (error) {
    console.error("Error listing folders:", error);
    return NextResponse.json(
      { error: "Failed to list folders" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gpx/folders - Create a new folder
 * Request body:
 *   - folderName (required) - Folder name
 *   - parentFolderId (optional) - Parent folder ID
 *   - isGlobal (optional) - Create global folder (admin only)
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
    const { folderName, parentFolderId, isGlobal } = await request.json();

    // Validate folder name
    if (!folderName || typeof folderName !== "string") {
      return NextResponse.json(
        { error: "folderName is required" },
        { status: 400 }
      );
    }

    const trimmedName = folderName.trim();
    if (trimmedName.length === 0) {
      return NextResponse.json(
        { error: "folderName cannot be empty" },
        { status: 400 }
      );
    }

    if (trimmedName.length > FOLDER_LIMITS.MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `folderName cannot exceed ${FOLDER_LIMITS.MAX_NAME_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Check global folder permission (admin only)
    const isAdmin = services.includes("admin");
    if (isGlobal && !isAdmin) {
      return NextResponse.json(
        { error: "Only admins can create global folders" },
        { status: 403 }
      );
    }

    // Determine userId for the folder
    const targetUserId = isGlobal ? "GLOBAL" : session.user.id;

    // Check folder count limit
    const allFolders = await GpxFolder.query
      .byUser({ userId: targetUserId })
      .go();

    const maxFolders = isGlobal
      ? FOLDER_LIMITS.MAX_GLOBAL_FOLDERS
      : FOLDER_LIMITS.MAX_FOLDERS_PER_USER;

    if (allFolders.data.length >= maxFolders) {
      return NextResponse.json(
        { error: `Maximum folder limit (${maxFolders}) reached` },
        { status: 400 }
      );
    }

    // Calculate depth and validate parent
    let depth = 0;
    if (parentFolderId) {
      const parentResult = await GpxFolder.get({
        userId: targetUserId,
        folderId: parentFolderId,
      }).go();

      if (!parentResult.data) {
        return NextResponse.json(
          { error: "Parent folder not found" },
          { status: 404 }
        );
      }

      depth = (parentResult.data.depth || 0) + 1;
      if (depth > FOLDER_LIMITS.MAX_DEPTH) {
        return NextResponse.json(
          { error: `Maximum folder depth (${FOLDER_LIMITS.MAX_DEPTH + 1} levels) exceeded` },
          { status: 400 }
        );
      }
    }

    // Check for duplicate name in same parent (case-insensitive)
    const targetParent = parentFolderId || "ROOT";
    const siblingFolders = await GpxFolder.query
      .byParent({ userId: targetUserId, parentFolderId: targetParent })
      .go();

    const duplicateExists = siblingFolders.data.some(
      (f) => f.folderName.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicateExists) {
      return NextResponse.json(
        { error: "A folder with this name already exists" },
        { status: 400 }
      );
    }

    // Create the folder
    const folderId = uuidv4();
    const folder = await GpxFolder.create({
      userId: targetUserId,
      folderId,
      folderName: trimmedName,
      parentFolderId: parentFolderId || "ROOT", // Use "ROOT" sentinel for root-level
      depth,
      isGlobal: isGlobal || false,
      createdBy: isGlobal ? session.user.id : undefined,
    }).go();

    return NextResponse.json({ folder: folder.data });
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 }
    );
  }
}
