import { NextResponse } from "next/server";
import { auth } from "@/config/auth";

/**
 * Middleware to protect /studio routes at the edge.
 *
 * Since /studio/* is served as static files via rewrites, the regular
 * page-level auth checks don't run. This middleware ensures users must
 * be authenticated before accessing the GPX Studio SvelteKit app.
 *
 * Uses Auth.js v5 middleware wrapper pattern - the `auth` function wraps
 * the middleware and provides `req.auth` with the decoded session.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Check if this is a protected route
  if (pathname.startsWith("/studio")) {
    // req.auth contains the session (null if not authenticated)
    if (!req.auth?.user) {
      // Not authenticated - redirect to signin
      // Use nextUrl.clone() to preserve basePath (e.g., /use1)
      const signinUrl = req.nextUrl.clone();
      signinUrl.pathname = "/signin";
      signinUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signinUrl);
    }

    // Check for gpxstudio service claim
    const services = (req.auth.user as { services?: string[] }).services ?? [];
    if (!services.includes("gpxstudio")) {
      // No gpxstudio access - redirect to access denied
      const accessDeniedUrl = req.nextUrl.clone();
      accessDeniedUrl.pathname = "/access-denied";
      return NextResponse.redirect(accessDeniedUrl);
    }
  }

  // Allow request to proceed
  return NextResponse.next();
});

// Only run middleware on /studio HTML entry points, not static assets
// This prevents auth checks on every JS/CSS/image request which causes slow loads
export const config = {
  matcher: [
    // Main entry points only - exclude static assets
    "/studio",
    "/studio/app",
    // Language routes (e.g., /studio/en/app)
    "/studio/:lang/app",
    // Exclude: _app (immutable assets), assets, images, fonts, etc.
  ],
};
