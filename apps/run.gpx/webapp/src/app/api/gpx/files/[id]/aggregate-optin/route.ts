import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/aggregate-optin - Opt a route in/out of the public
 * "All Runners" aggregate overlay (Phase 32).
 *
 * The aggregate is blended and NON-attributable, so this is separate from public sharing:
 * opting in contributes the route's shape to the heatmap with no name or id attached. It's
 * the ONLY public surface allowed for Strava-derived routes (they can opt into the
 * aggregate even while `publicShareEligible:false`).
 *
 * Body: { include: boolean }
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
    const { include } = await request.json();
    if (typeof include !== "boolean") {
      return NextResponse.json(
        { error: "include (boolean) is required" },
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
      .set({ includeInAggregate: include })
      .go({ response: "all_new" });

    return NextResponse.json({ file: result.data });
  } catch (error) {
    console.error("Error updating aggregate opt-in:", error);
    return NextResponse.json(
      { error: "Failed to update aggregate opt-in" },
      { status: 500 }
    );
  }
}
