import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const isDev = process.env.NODE_ENV !== "production";
const cookieDomain = isDev ? "localhost" : process.env.AUTH_COOKIE_DOMAIN;

/**
 * Custom logout endpoint that clears Auth.js session cookie without CSRF.
 * Used by OIDC postLogoutSuccessSource to complete the logout chain.
 *
 * GET /api/logout?callbackUrl=http://localhost:3001
 */
export async function GET(request: NextRequest) {
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl")
    || (isDev ? "http://localhost:3001" : "https://run.defcon.run");

  const cookieStore = await cookies();

  // Clear the Auth.js session cookie
  cookieStore.set("sess_auth", "", {
    domain: cookieDomain,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: !isDev,
    maxAge: 0, // Expire immediately
  });

  // Also clear CSRF and callback cookies
  cookieStore.set("csrf_auth", "", {
    domain: cookieDomain,
    path: "/",
    maxAge: 0,
  });

  cookieStore.set("callback_auth", "", {
    domain: cookieDomain,
    path: "/",
    maxAge: 0,
  });

  // Clear OIDC provider cookies (these should already be cleared by end_session,
  // but clear them explicitly to be safe)
  const oidcCookies = [
    "_session",
    "_session.legacy",
    "_interaction",
    "_interaction.legacy",
    "_interaction_resume",
    "_interaction_resume.legacy",
  ];

  for (const name of oidcCookies) {
    cookieStore.set(name, "", {
      path: "/",
      maxAge: 0,
    });
  }

  // Redirect to the callback URL
  return NextResponse.redirect(callbackUrl);
}
