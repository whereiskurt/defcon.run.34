import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";

/**
 * GET /api/gpx/admin/share-requests - Admin curation queue (Phase 30).
 *
 * Lists every route with `shareRequested === true` across all users, so an admin can
 * curate the good ones into the "Rabbit Routes" GLOBAL folder (approve → copy). Uses an
 * admin-only filtered scan — the flagged set is small and this view is infrequent, so no
 * GSI / infra is warranted.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("admin")) {
    return NextResponse.json(
      { error: "Only admins can view share requests" },
      { status: 403 }
    );
  }

  try {
    // Filtered scan: flagged, active, non-GLOBAL (a viewer's own private route).
    const result = await GpxFile.scan
      .where(
        (attr, op) =>
          `${op.eq(attr.shareRequested, true)} AND ${op.eq(attr.status, "active")}`
      )
      .go({ pages: "all" });

    const requests = result.data
      .filter((f) => f.userId !== "GLOBAL")
      .map((f) => ({
        userId: f.userId,
        fileId: f.fileId,
        fileName: f.fileName,
        totalDistance: f.totalDistance,
        totalElevation: f.totalElevation,
        trackCount: f.trackCount,
        createdAt: f.createdAt,
      }));

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Error listing share requests:", error);
    return NextResponse.json(
      { error: "Failed to list share requests" },
      { status: 500 }
    );
  }
}
