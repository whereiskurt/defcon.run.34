import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFolder, FOLDER_LIMITS } from "@/entities/gpx-folder";
import { GpxFile } from "@/entities/gpx-file";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/gpx/folders/[id] - Get folder details
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
    // Try user folder first
    let result = await GpxFolder.get({
      userId: session.user.id,
      folderId: id,
    }).go();

    // If not found, try global folder
    if (!result.data) {
      result = await GpxFolder.get({
        userId: "GLOBAL",
        folderId: id,
      }).go();
    }

    if (!result.data) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    // Count items in folder
    const filesResult = await GpxFile.query
      .byFolder({ userId: result.data.userId, folderId: id })
      .go();

    const subFolders = await GpxFolder.query
      .byParent({ userId: result.data.userId })
      .where(({ parentFolderId }, { eq }) => eq(parentFolderId, id))
      .go();

    return NextResponse.json({
      folder: result.data,
      fileCount: filesResult.data.length,
      subFolderCount: subFolders.data.length,
    });
  } catch (error) {
    console.error("Error getting folder:", error);
    return NextResponse.json(
      { error: "Failed to get folder" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/gpx/folders/[id] - Rename a folder
 * Request body:
 *   - folderName (required) - New folder name
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

  try {
    const { folderName } = await request.json();

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

    // Try to find the folder (user or global)
    let folder = await GpxFolder.get({
      userId: session.user.id,
      folderId: id,
    }).go();

    let targetUserId = session.user.id;

    if (!folder.data) {
      // Check if it's a global folder
      folder = await GpxFolder.get({
        userId: "GLOBAL",
        folderId: id,
      }).go();

      if (!folder.data) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }

      // For global folders, only creator or admin can rename
      const isAdmin = services.includes("admin");
      if (folder.data.createdBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the folder creator or admin can rename global folders" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Check for duplicate name in same parent (case-insensitive)
    const parentFolderId = folder.data.parentFolderId;
    const siblingFolders = parentFolderId
      ? await GpxFolder.query
          .byParent({ userId: targetUserId })
          .where(({ parentFolderId: pf }, { eq }) => eq(pf, parentFolderId))
          .go()
      : await GpxFolder.query
          .byParent({ userId: targetUserId })
          .where(({ parentFolderId: pf }, { notExists }) => notExists(pf))
          .go();

    const duplicateExists = siblingFolders.data.some(
      (f) =>
        f.folderId !== id &&
        f.folderName.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicateExists) {
      return NextResponse.json(
        { error: "A folder with this name already exists" },
        { status: 400 }
      );
    }

    // Update the folder
    const result = await GpxFolder.update({
      userId: targetUserId,
      folderId: id,
    })
      .set({ folderName: trimmedName })
      .go({ response: "all_new" });

    return NextResponse.json({ folder: result.data });
  } catch (error) {
    console.error("Error renaming folder:", error);
    return NextResponse.json(
      { error: "Failed to rename folder" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gpx/folders/[id] - Delete an empty folder
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

  try {
    // Try to find the folder (user or global)
    let folder = await GpxFolder.get({
      userId: session.user.id,
      folderId: id,
    }).go();

    let targetUserId = session.user.id;

    if (!folder.data) {
      // Check if it's a global folder
      folder = await GpxFolder.get({
        userId: "GLOBAL",
        folderId: id,
      }).go();

      if (!folder.data) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }

      // For global folders, only creator or admin can delete
      const isAdmin = services.includes("admin");
      if (folder.data.createdBy !== session.user.id && !isAdmin) {
        return NextResponse.json(
          { error: "Only the folder creator or admin can delete global folders" },
          { status: 403 }
        );
      }

      targetUserId = "GLOBAL";
    }

    // Check if folder is empty (no files)
    const filesResult = await GpxFile.query
      .byFolder({ userId: targetUserId, folderId: id })
      .go();

    if (filesResult.data.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete folder - it contains files. Please empty the folder first." },
        { status: 409 }
      );
    }

    // Check if folder has subfolders
    const subFolders = await GpxFolder.query
      .byParent({ userId: targetUserId })
      .where(({ parentFolderId }, { eq }) => eq(parentFolderId, id))
      .go();

    if (subFolders.data.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete folder - it contains subfolders. Please empty the folder first." },
        { status: 409 }
      );
    }

    // Delete the folder
    await GpxFolder.delete({
      userId: targetUserId,
      folderId: id,
    }).go();

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 }
    );
  }
}
