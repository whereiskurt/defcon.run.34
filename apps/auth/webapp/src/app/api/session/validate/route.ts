import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * Session Validation Endpoint (App Router)
 *
 * This endpoint allows other *.defcon.run services to validate the shared
 * session cookie and retrieve user claims including authorized services.
 *
 * Usage:
 *   GET https://auth.defcon.run/api/session/validate
 *   Cookie: sess=<session-token>
 *
 * Response (authenticated):
 *   {
 *     "valid": true,
 *     "user": {
 *       "id": "user-id",
 *       "email": "user@example.com",
 *       "name": "User Name",
 *       "picture": "https://...",
 *       "services": ["auth", "run", "gpx", "admin"]
 *     },
 *     "expires": "2025-01-15T00:00:00.000Z"
 *   }
 *
 * Response (unauthenticated):
 *   {
 *     "valid": false,
 *     "error": "no_session"
 *   }
 *
 * Optional query parameters:
 *   - service: Check if user has access to a specific service
 *     GET /api/session/validate?service=gpx
 *     Returns 403 if user doesn't have access to the specified service
 */

export type SessionValidateResponse =
  | {
      valid: true;
      user: {
        id: string;
        email: string | null;
        name: string | null;
        picture: string | null;
        services: string[];
      };
      expires: string;
    }
  | {
      valid: false;
      error: "no_session" | "invalid_session" | "service_not_authorized";
      requiredService?: string;
    };

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {};
  if (origin && origin.endsWith(".defcon.run")) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(origin),
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    // Get the JWT token directly from the session cookie
    // Use the custom cookie name "sess" that's configured in auth.ts
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET?.split(","),
      cookieName: "sess",
    });

    if (!token) {
      return NextResponse.json(
        { valid: false, error: "no_session" } as SessionValidateResponse,
        { status: 401, headers }
      );
    }

    // Get the full profile including services
    const userId = (token.sub || token.email) as string | undefined;
    let services: string[] = [];

    if (userId) {
      const profile = await getAuthProfile(userId);
      if (profile?.services) {
        services = profile.services;
      }
    }

    // Check if a specific service is required
    const requiredService = request.nextUrl.searchParams.get("service");
    if (requiredService && !services.includes(requiredService)) {
      return NextResponse.json(
        {
          valid: false,
          error: "service_not_authorized",
          requiredService,
        } as SessionValidateResponse,
        { status: 403, headers }
      );
    }

    // Calculate expiry from token
    const expires = token.exp
      ? new Date(token.exp * 1000).toISOString()
      : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

    return NextResponse.json(
      {
        valid: true,
        user: {
          id: userId || "",
          email: (token.email as string) || null,
          name: (token.name as string) || null,
          picture: (token.picture as string) || null,
          services,
        },
        expires,
      } as SessionValidateResponse,
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Session validation error:", error);
    return NextResponse.json(
      { valid: false, error: "invalid_session" } as SessionValidateResponse,
      { status: 401, headers }
    );
  }
}
