import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/request-share - Toggle the "wants to be shared" flag on an
 * owned route (community contribution — Phase 30).
 *
 * Sets `shareRequested` on the user's own file. Admins later curate flagged routes into
 * the "Rabbit Routes" GLOBAL folder (see /api/gpx/admin/share-requests). Flagging does
 * NOT make a route public by itself.
 *
 * Body: { requested: boolean }
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

  try {
    const { requested } = await request.json();
    if (typeof requested !== "boolean") {
      return NextResponse.json(
        { error: "requested (boolean) is required" },
        { status: 400 }
      );
    }

    const file = await GpxFile.get({
      userId: session.user.id,
      fileId: id,
    }).go();
    if (!file.data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const result = await GpxFile.update({
      userId: session.user.id,
      fileId: id,
    })
      .set({ shareRequested: requested })
      .go({ response: "all_new" });

    return NextResponse.json({ file: result.data });
  } catch (error) {
    console.error("Error updating share request:", error);
    return NextResponse.json(
      { error: "Failed to update share request" },
      { status: 500 }
    );
  }
}
