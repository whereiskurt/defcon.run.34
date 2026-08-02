import { NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { GpxShare } from "@/entities/gpx-share";
import { s3Client } from "@/lib/s3-client";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { reconcileBestEffort } from "@/lib/gpx-reconcile";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

/**
 * Admin moderation of a single heat-map run. Non-admins get 404 throughout.
 *
 * `userId` is required on both verbs and comes from the roster: GpxFile's pk is
 * (userId, fileId), so an admin acting on someone else's run must name the
 * owner. It is NOT taken from the session — that would only ever address the
 * admin's own runs.
 *
 * POST   { userId, hidden }  → reversible pull from the heat map
 * DELETE ?userId=…           → destroys the run outright
 *
 * NEITHER rebuilds the artifact. The public map keeps serving the prebuilt
 * `uploads/HEATMAP/dc34.json` until someone calls .../heatmap/rebuild, which is
 * deliberate: moderating ten shapes should cost one rebuild, not ten. The admin
 * UI shows how many changes are pending and offers the rebuild button.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const gate = await adminGate();
  if (gate) return gate;

  const { fileId } = await params;

  try {
    const { userId, hidden } = await request.json();
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (typeof hidden !== "boolean") {
      return NextResponse.json(
        { error: "hidden (boolean) is required" },
        { status: 400 }
      );
    }

    const existing = await GpxFile.get({ userId, fileId }).go();
    if (!existing.data) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (hidden) {
      await GpxFile.update({ userId, fileId }).set({ heatmapHidden: true }).go();
    } else {
      // Remove rather than set false so the row goes back to looking exactly
      // like one that was never moderated.
      await GpxFile.update({ userId, fileId }).remove(["heatmapHidden"]).go();
    }

    logEvent("gpx.heatmap.admin_hide", {
      headers: request.headers,
      meta: { fileId, ownerId: userId, hidden },
    });

    return NextResponse.json({ fileId, hidden });
  } catch (error) {
    console.error("Error updating heat-map visibility:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const gate = await adminGate();
  if (gate) return gate;

  const { fileId } = await params;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const existing = await GpxFile.get({ userId, fileId }).go();
    if (!existing.data) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Same cascade the owner-facing delete performs: shares, then S3, then the
    // row, then re-converge the leaderboard because a scored con-day run just
    // disappeared.
    const shares = await GpxShare.query.byFile({ ownerId: userId, fileId }).go();
    for (const share of shares.data ?? []) {
      await GpxShare.delete({ shareId: share.shareId }).go();
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: existing.data.bucket,
        Key: existing.data.key,
      })
    );
    await GpxFile.delete({ userId, fileId }).go();
    reconcileBestEffort(userId);

    logEvent("gpx.heatmap.admin_delete", {
      headers: request.headers,
      meta: { fileId, ownerId: userId, fileName: existing.data.fileName },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Error deleting heat-map run:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

/** Shared 401/404/403 gate. Returns a response to short-circuit, or null. */
async function adminGate(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }
  return null;
}
