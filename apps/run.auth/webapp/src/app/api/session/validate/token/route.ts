import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Internal Token Validation Endpoint (Server-to-Server)
 *
 * This endpoint allows other defcon.run services to validate a sess_auth
 * JWT token. The calling service reads the cookie and passes it here.
 *
 * Protected by shared secret (X-Internal-Secret header).
 *
 * Usage:
 *   POST https://auth.defcon.run/api/session/validate/token
 *   Headers:
 *     X-Internal-Secret: <shared-secret>
 *     Content-Type: application/json
 *   Body: { "token": "<sess_auth cookie value>" }
 *
 * Response (valid):
 *   { "valid": true, "user": { "id": "...", "email": "...", "name": "..." } }
 *
 * Response (invalid):
 *   { "valid": false, "error": "invalid_token" | "expired" | "unauthorized" }
 */

export type TokenValidateResponse =
  | {
      valid: true;
      user: {
        id: string;
        email: string | null;
        name: string | null;
      };
    }
  | {
      valid: false;
      error: "unauthorized" | "invalid_token" | "expired" | "missing_token";
    };

export async function POST(request: NextRequest) {
  // Verify internal secret
  const internalSecret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.AUTH_INTERNAL_SECRET;

  if (!expectedSecret || internalSecret !== expectedSecret) {
    return NextResponse.json(
      { valid: false, error: "unauthorized" } as TokenValidateResponse,
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const token = body.token;

    if (!token) {
      return NextResponse.json(
        { valid: false, error: "missing_token" } as TokenValidateResponse,
        { status: 400 }
      );
    }

    // Create a mock request with the token as a cookie for getToken to work
    const mockHeaders = new Headers();
    mockHeaders.set("cookie", `sess_auth=${token}`);

    const mockRequest = {
      headers: mockHeaders,
      cookies: {
        get: (name: string) => (name === "sess_auth" ? { value: token } : undefined),
      },
    };

    // Validate and decode the JWT
    const decoded = await getToken({
      req: mockRequest as any,
      secret: process.env.AUTH_JWT_SECRET?.split(",")[0],
      cookieName: "sess_auth",
    });

    if (!decoded) {
      return NextResponse.json(
        { valid: false, error: "invalid_token" } as TokenValidateResponse,
        { status: 401 }
      );
    }

    // Check expiration
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      return NextResponse.json(
        { valid: false, error: "expired" } as TokenValidateResponse,
        { status: 401 }
      );
    }

    const userId = (decoded.sub || decoded.email) as string;

    return NextResponse.json({
      valid: true,
      user: {
        id: userId,
        email: (decoded.email as string) || null,
        name: (decoded.name as string) || null,
      },
    } as TokenValidateResponse);
  } catch (error) {
    console.error("Token validation error:", error);
    return NextResponse.json(
      { valid: false, error: "invalid_token" } as TokenValidateResponse,
      { status: 401 }
    );
  }
}
