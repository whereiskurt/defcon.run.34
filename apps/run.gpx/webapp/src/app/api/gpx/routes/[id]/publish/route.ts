import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isPublishCapped } from "@/lib/route-caps";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/routes/[id]/publish — owner only (404 otherwise), self-serve.
 * The route immediately appears in the community listing; admins can pull it
 * (after-the-fact moderation, spec section 7). Publish cap: 20/user.
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
    if (!route.data || route.data.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }
    if (route.data.status !== "active") {
      return NextResponse.json(
        { error: "Only an active route can be published" },
        { status: 400 }
      );
    }
    if (route.data.visibility === "published") {
      return NextResponse.json({ success: true, route: route.data });
    }

    const isAdmin = services.includes("admin");
    const mine = await Route.query
      .byOwner({ ownerId: session.user.id })
      .go({ pages: "all" });
    const publishedCount = mine.data.filter(
      (r) => r.visibility === "published"
    ).length;
    if (isPublishCapped(publishedCount, isAdmin)) {
      return NextResponse.json(
        { error: "Published route limit reached" },
        { status: 429 }
      );
    }

    const result = await Route.update({ routeId: id })
      .set({ visibility: "published", publishedAt: Date.now() })
      .go({ response: "all_new" });

    logEvent("gpx.route.publish", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { routeId: id },
    });

    return NextResponse.json({ success: true, route: result.data });
  } catch (error) {
    console.error("Error publishing route:", error);
    return NextResponse.json(
      { error: "Failed to publish route" },
      { status: 500 }
    );
  }
}
