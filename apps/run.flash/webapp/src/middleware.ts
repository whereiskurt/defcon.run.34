import { auth } from "@/config/auth";
import { NextResponse } from "next/server";

/**
 * Middleware to protect all routes.
 *
 * Requires authentication AND "flash" service claim (like run.gpx checks
 * for "gpxstudio"). Unauthenticated users are redirected to signin.
 * Authenticated users without the "flash" claim get access-denied.
 *
 * Uses Auth.js v5 middleware wrapper pattern - the `auth` function wraps
 * the middleware and provides `req.auth` with the decoded session.
 */
export default auth((req) => {
  // req.auth contains the session (null if not authenticated)
  if (!req.auth?.user) {
    // Not authenticated - redirect to signin
    // Use nextUrl.clone() to preserve basePath (e.g., /use1)
    const signinUrl = req.nextUrl.clone();
    signinUrl.pathname = "/signin";
    signinUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signinUrl);
  }

  // Check for flash service claim
  const services = (req.auth.user as { services?: string[] }).services ?? [];
  if (!services.includes("flash")) {
    const accessDeniedUrl = req.nextUrl.clone();
    accessDeniedUrl.pathname = "/access-denied";
    return NextResponse.redirect(accessDeniedUrl);
  }

  // Allow request to proceed
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|signin|access-denied|img|data).*)"],
};
