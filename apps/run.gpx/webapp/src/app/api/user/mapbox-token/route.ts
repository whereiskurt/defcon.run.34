import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { resolveMapboxToken, validateMapboxToken } from "@/lib/mapbox-token";
import { logEvent } from "@/lib/log-event";
import { assertNotLockedLive } from "@/lib/live-lockout";

// Auth service URL for internal API calls
const LOCAL_AUTH_PORT = process.env.LOCAL_AUTH_PORT || "3002";
const authServiceUrl = process.env.AUTH_SERVICE_URL || `http://localhost:${LOCAL_AUTH_PORT}`;

/**
 * GET /api/user/mapbox-token - Get the resolved Mapbox token for current user
 * Returns the user's personal token if set, otherwise the default system token
 */
export async function GET(request: Request) {
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

    // Leading indicator (AR-08b): the client requests the Mapbox token immediately
    // before rendering a map, so this is our real-time proxy for a map view. Our
    // logs are live whereas the Mapbox usage dashboard lags ~24h. Fire-and-forget.
    logEvent("gpx.map.view", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { isPersonal: !!userToken },
    });

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

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
    const { token } = await request.json();

    // Allow clearing the token
    if (token === null || token === "") {
      // Clear the token by calling auth service
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

  // Live lock-out check at the write boundary: a locked identity is blocked
  // from mutating immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
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
