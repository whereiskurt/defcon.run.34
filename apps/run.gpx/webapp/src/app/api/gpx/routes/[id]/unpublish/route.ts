import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/routes/[id]/unpublish — owner or admin; anyone else sees the
 * same 404 a nonexistent route would produce. Removing publishedAt drops the
 * row out of the byVisibility GSI, so it vanishes from the community listing.
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

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const route = await Route.get({ routeId: id }).go();
    const isAdmin = services.includes("admin");
    if (
      !route.data ||
      (route.data.ownerId !== session.user.id && !isAdmin)
    ) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }

    const result = await Route.update({ routeId: id })
      .set({ visibility: "private" })
      .remove(["publishedAt"])
      .go({ response: "all_new" });

    logEvent("gpx.route.unpublish", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { routeId: id, admin: isAdmin && route.data.ownerId !== session.user.id },
    });

    return NextResponse.json({ success: true, route: result.data });
  } catch (error) {
    console.error("Error unpublishing route:", error);
    return NextResponse.json(
      { error: "Failed to unpublish route" },
      { status: 500 }
    );
  }
}
