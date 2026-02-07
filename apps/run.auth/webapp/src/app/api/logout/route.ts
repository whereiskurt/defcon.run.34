import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_RUN_PORT = process.env.LOCAL_RUN_PORT || "3001";
const cookieDomain = isDev ? "localhost" : process.env.AUTH_COOKIE_DOMAIN;

/**
 * Custom logout endpoint that clears Auth.js session cookie without CSRF.
 * Used by OIDC postLogoutSuccessSource to complete the logout chain.
 *
 * GET /api/logout?callbackUrl=http://localhost:{LOCAL_RUN_PORT}
 */
export async function GET(request: NextRequest) {
  const defaultRedirect = isDev
    ? `http://localhost:${LOCAL_RUN_PORT}`
    : `https://run.${siteDomain}/${REGION_SHORT}`;
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || defaultRedirect;

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
  // In production, these are set with domain: ".{siteDomain}" so we must clear with same domain
  const oidcCookieDomain = isDev ? undefined : `.${siteDomain}`;
  const oidcCookies = [
    "_session",
    "_session.sig",
    "_session.legacy",
    "_session.legacy.sig",
    "_interaction",
    "_interaction.sig",
    "_interaction.legacy",
    "_interaction.legacy.sig",
    "_interaction_resume",
    "_interaction_resume.sig",
    "_interaction_resume.legacy",
    "_interaction_resume.legacy.sig",
  ];

  for (const name of oidcCookies) {
    cookieStore.set(name, "", {
      path: "/",
      domain: oidcCookieDomain,
      maxAge: 0,
    });
  }

  // Redirect to the callback URL
  return NextResponse.redirect(callbackUrl);
}
