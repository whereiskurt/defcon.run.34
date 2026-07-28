import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/admin/routes/[id]/unpublish — admin moderation pull.
 * Non-admins get 404 (non-disclosure).
 */
export async function POST(request: Request, { params }: RouteParams) {
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

  const { id } = await params;

  try {
    const route = await Route.get({ routeId: id }).go();
    if (!route.data) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }

    const result = await Route.update({ routeId: id })
      .set({ visibility: "private" })
      .remove(["publishedAt"])
      .go({ response: "all_new" });

    logEvent("gpx.route.admin_unpublish", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { routeId: id, ownerId: route.data.ownerId },
    });

    return NextResponse.json({ success: true, route: result.data });
  } catch (error) {
    console.error("Error admin-unpublishing route:", error);
    return NextResponse.json(
      { error: "Failed to unpublish route" },
      { status: 500 }
    );
  }
}
