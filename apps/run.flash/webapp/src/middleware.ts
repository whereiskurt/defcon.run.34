import { auth } from "@/config/auth";
import { NextResponse } from "next/server";

/**
 * Middleware to protect all routes.
 *
 * All authenticated DCR34 users can access the flasher -- no service-specific
 * claim check is needed (unlike run.gpx which checks for "gpxstudio" service).
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

  // Allow request to proceed
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|signin|img|data).*)"],
};
