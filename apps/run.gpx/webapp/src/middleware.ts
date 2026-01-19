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
      const signinUrl = new URL("/signin", req.url);
      signinUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signinUrl);
    }

    // Check for gpxstudio service claim
    const services = (req.auth.user as { services?: string[] }).services ?? [];
    if (!services.includes("gpxstudio")) {
      // No gpxstudio access - redirect to access denied
      const accessDeniedUrl = new URL("/access-denied", req.url);
      return NextResponse.redirect(accessDeniedUrl);
    }
  }

  // Allow request to proceed
  return NextResponse.next();
});

// Only run middleware on /studio routes (the SvelteKit app)
export const config = {
  matcher: [
    "/studio/:path*",
  ],
};
