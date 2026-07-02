import { NextResponse } from "next/server";
import { auth } from "@/config/auth";

/**
 * Full-app auth gate for run.bib.
 *
 * Unlike run.gpx (which only gates /studio), run.bib is a member-only
 * bib-registration app — every route requires an authenticated session
 * EXCEPT the whitelist below.
 *
 * Whitelist:
 *   /signin, /access-denied           — needed to run the login flow itself
 *   /api/auth/*                       — Auth.js internal handlers
 *   /api/health                       — load balancer / ALB health checks
 *   /api/stripe/webhook               — Stripe callbacks (no session cookie; HMAC-verified via whsec_*)
 *
 * Everything else redirects unauthenticated requests to /signin with a
 * callbackUrl pointing back at the requested URL.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const basePath = req.nextUrl.basePath || "";

  // In prod with basePath (e.g. `/use1`), `pathname` includes the prefix —
  // strip it for the whitelist comparison so entries like `"/signin"` match
  // both dev (no basePath) and prod (`/use1/signin`).
  const relPath =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;

  // Whitelist paths that must remain reachable without a session.
  const isWhitelisted =
    relPath === "/signin" ||
    relPath === "/access-denied" ||
    relPath.startsWith("/api/auth/") ||
    relPath === "/api/auth" ||
    relPath === "/api/health" ||
    relPath === "/api/stripe/webhook";

  if (isWhitelisted) {
    return NextResponse.next();
  }

  if (!req.auth?.user) {
    // Not authenticated — redirect to signin, preserving basePath (e.g. /use1).
    const signinUrl = req.nextUrl.clone();
    signinUrl.pathname = `${basePath}/signin`;
    signinUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signinUrl);
  }

  return NextResponse.next();
});

// Middleware matcher: run on all routes except Next.js internals + static assets.
// This gates every page/API route the whitelist doesn't cover.
export const config = {
  matcher: [
    // Match everything except:
    //   - _next/* (Next.js build/asset requests)
    //   - favicon.ico, images, fonts, etc. under /public with a file extension
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf)$).*)",
  ],
};
