import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { resolveMapboxToken, validateMapboxToken } from "@/lib/mapbox-token";

/**
 * GET /api/user/mapbox-token - Get the resolved Mapbox token for current user
 * Returns the user's personal token if set, otherwise the default system token
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const userToken = (session.user as { mapboxPublicToken?: string })
      .mapboxPublicToken;
    const token = resolveMapboxToken(userToken);

    return NextResponse.json({
      token,
      isPersonal: !!userToken,
    });
  } catch (error) {
    console.error("Error resolving Mapbox token:", error);
    return NextResponse.json(
      { error: "Failed to resolve Mapbox token" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/mapbox-token - Update user's personal Mapbox token
 * Token is stored in AuthProfile via the auth service
 */
export async function PUT(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const { token } = await request.json();

    // Allow clearing the token
    if (token === null || token === "") {
      // Clear the token by calling auth service
      const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:3002";
      const response = await fetch(
        `${authServiceUrl}/api/profile/mapbox-token`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.user.id}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return NextResponse.json(
          { error: error.message || "Failed to clear token" },
          { status: response.status }
        );
      }

      return NextResponse.json({ success: true, cleared: true });
    }

    // Validate the token format
    const validation = validateMapboxToken(token);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update the token via auth service
    const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:3002";
    const response = await fetch(`${authServiceUrl}/api/profile/mapbox-token`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session.user.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.message || "Failed to update token" },
        { status: response.status }
      );
    }

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
 * DELETE /api/user/mapbox-token - Clear user's personal Mapbox token
 */
export async function DELETE() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:3002";
    const response = await fetch(`${authServiceUrl}/api/profile/mapbox-token`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.user.id}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.message || "Failed to clear token" },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing Mapbox token:", error);
    return NextResponse.json(
      { error: "Failed to clear Mapbox token" },
      { status: 500 }
    );
  }
}
