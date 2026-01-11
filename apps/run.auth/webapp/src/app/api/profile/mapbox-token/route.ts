import { NextResponse } from "next/server";
import { AuthProfile } from "@/entities/auth-profile";

/**
 * Internal API for managing user's Mapbox token
 * Called by GPX Studio service with service-to-service auth
 */

function getUserIdFromAuth(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * GET /api/profile/mapbox-token - Get user's Mapbox token
 */
export async function GET(request: Request) {
  const userId = getUserIdFromAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await AuthProfile.get({ userId }).go();
    if (!result.data) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({
      mapboxPublicToken: result.data.mapboxPublicToken || null,
    });
  } catch (error) {
    console.error("Error getting Mapbox token:", error);
    return NextResponse.json(
      { error: "Failed to get Mapbox token" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/profile/mapbox-token - Update user's Mapbox token
 */
export async function PUT(request: Request) {
  const userId = getUserIdFromAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { token } = await request.json();

    // Validate token format (must be public token)
    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Token is required" },
        { status: 400 }
      );
    }

    if (token.startsWith("sk.")) {
      return NextResponse.json(
        { error: "Secret tokens (sk.*) are not allowed" },
        { status: 400 }
      );
    }

    if (!token.startsWith("pk.")) {
      return NextResponse.json(
        { error: "Invalid token format. Must start with pk." },
        { status: 400 }
      );
    }

    await AuthProfile.update({ userId })
      .set({ mapboxPublicToken: token })
      .go();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating Mapbox token:", error);
    return NextResponse.json(
      { error: "Failed to update Mapbox token" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/profile/mapbox-token - Clear user's Mapbox token
 */
export async function DELETE(request: Request) {
  const userId = getUserIdFromAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await AuthProfile.update({ userId })
      .remove(["mapboxPublicToken"])
      .go();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing Mapbox token:", error);
    return NextResponse.json(
      { error: "Failed to clear Mapbox token" },
      { status: 500 }
    );
  }
}
