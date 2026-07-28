import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Route } from "@/entities/route";

/**
 * GET /api/gpx/admin/routes — moderation list of published community routes.
 * Non-disclosure gate: non-admins get the same 404 a missing path would give
 * (routes-vs-runs spec section 7). Admins MAY see ownerId here — this is the
 * moderation surface; the public community listing never exposes it.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await Route.query
      .byVisibility({ visibility: "published" })
      .go({ order: "desc", pages: "all" });

    const routes = result.data.map((r) => ({
      routeId: r.routeId,
      name: r.name,
      description: r.description,
      routeType: r.routeType,
      ownerId: r.ownerId,
      createdByName: r.createdByName,
      totalDistance: r.totalDistance,
      copyCount: r.copyCount,
      publishedAt: r.publishedAt,
      status: r.status,
    }));

    return NextResponse.json({ routes });
  } catch (error) {
    console.error("Error listing routes for admin:", error);
    return NextResponse.json(
      { error: "Failed to list routes" },
      { status: 500 }
    );
  }
}
