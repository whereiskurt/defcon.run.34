import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { viewWithoutBasePath } from "@/lib/middleware-path";

/**
 * Middleware to protect /studio routes at the edge.
 *
 * Since /studio/* is served as static files via rewrites, the regular
 * page-level auth checks don't run. This middleware ensures users must
 * be authenticated before accessing the GPX Studio SvelteKit app.
 *
 * Uses Auth.js v5 middleware wrapper pattern - the `auth` function wraps
 * the middleware and provides `req.auth` with the decoded session.
 *
 * ── basePath hazard (fixed 2026-08-02) ──────────────────────────────────────
 * The pathname reaching this guard may or may not still carry the `/use1`
 * basePath depending on RUNTIME config — see `@/lib/middleware-path` for the
 * full account of the anonymous-empty-globe bug this prevents. The compiled
 * matcher already embeds the basePath, so it never needed changing.
 */
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const BASE_PATH =
  process.env.NODE_ENV === "production" ? `/${REGION_SHORT}` : "";

export default auth((req) => {
  const { pathname, target } = viewWithoutBasePath(
    req.nextUrl.pathname,
    BASE_PATH,
  );

  // Check if this is a protected route
  if (pathname.startsWith("/studio")) {
    // req.auth contains the session (null if not authenticated)
    if (!req.auth?.user) {
      // Not authenticated - redirect to signin
      // Use nextUrl.clone() to preserve basePath (e.g., /use1)
      const signinUrl = req.nextUrl.clone();
      signinUrl.pathname = target("/signin");
      signinUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signinUrl);
    }

    // Check for gpxstudio service claim
    const services = (req.auth.user as { services?: string[] }).services ?? [];
    if (!services.includes("gpxstudio")) {
      // No gpxstudio access - redirect to access denied
      const accessDeniedUrl = req.nextUrl.clone();
      accessDeniedUrl.pathname = target("/access-denied");
      return NextResponse.redirect(accessDeniedUrl);
    }

    // Canonical URL: always redirect /studio and /studio/ to /studio/app
    if (pathname === "/studio" || pathname === "/studio/") {
      const appUrl = req.nextUrl.clone();
      appUrl.pathname = target("/studio/app");
      return NextResponse.redirect(appUrl);
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
