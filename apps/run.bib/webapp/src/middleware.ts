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
 *   /silent-callback                  — silent-SSO iframe bridge (posts outcome to parent)
 *   /api/auth/*                       — Auth.js internal handlers (interactive instance)
 *   /api/silent-auth/*                — Auth.js silent-SSO instance (its callback mints the session)
 *   /api/health                       — load balancer / ALB health checks
 *   /api/stripe/webhook               — Stripe callbacks (no session cookie; HMAC-verified via whsec_*)
 *   /api/checkout/general             — cross-origin donate modal (run/flash); route self-gates (CORS origin allowlist + own 401)
 *
 * Everything else redirects unauthenticated requests to /signin with a
 * callbackUrl pointing back at the requested URL.
 */
// basePath is set at build time from REGION_SHORT (see next.config.ts).
// `req.nextUrl.basePath` is empty in middleware because middleware runs
// before Next.js applies the basePath rewrite; read from env directly.
// NEXT_PUBLIC_REGION_SHORT is baked into the client bundle at build time,
// which the middleware bundle picks up too — REGION_SHORT alone is not
// available in the Edge middleware runtime without an explicit env pass.
const REGION_BASEPATH =
  process.env.NEXT_PUBLIC_REGION_SHORT
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT}`
    : process.env.REGION_SHORT
      ? `/${process.env.REGION_SHORT}`
      : "";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Auth.js generates redirect_uri using its own basePath = "/api/auth"
  // (see config/auth.ts). Because Next.js `basePath: /use1` strips the
  // prefix BEFORE Auth.js sees the request, Auth.js can't include /use1
  // in the redirect_uri it sends to the OIDC server. The auth server then
  // redirects the browser back to a NAKED URL like
  // /api/auth/callback/run.defcon.run which — without a rewrite — hits
  // Next.js at that path and 404s (no route exists outside basePath).
  //
  // Rewrite naked /api/auth/* to /use1/api/auth/* so Next.js can match
  // the route file (routing strips /use1 again, so the file at
  // src/app/api/auth/[...nextauth]/route.ts serves both URLs).
  if (
    REGION_BASEPATH &&
    (pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/silent-auth/")) &&
    !pathname.startsWith(REGION_BASEPATH)
  ) {
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `${REGION_BASEPATH}${pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // In prod with basePath (e.g. `/use1`), incoming pathname INCLUDES the
  // prefix — strip it for the whitelist comparison so entries like
  // `"/signin"` match both dev (no basePath) and prod (`/use1/signin`).
  const relPath =
    REGION_BASEPATH && pathname.startsWith(REGION_BASEPATH)
      ? pathname.slice(REGION_BASEPATH.length) || "/"
      : pathname;

  // Whitelist paths that must remain reachable without a session.
  const isWhitelisted =
    relPath === "/signin" ||
    relPath === "/access-denied" ||
    // Bridge page: the prompt=none iframe lands here to postMessage its
    // outcome. On login_required the request is unauthenticated by
    // definition — gating it starves the parent of the message and forces
    // every silent probe into the 4.5s timeout fallback.
    relPath === "/silent-callback" ||
    relPath.startsWith("/api/auth/") ||
    relPath === "/api/auth" ||
    // Isolated silent-SSO Auth.js instance (config/auth.ts). Its OAuth
    // callback mints the session, so it can never carry one on the way in.
    relPath.startsWith("/api/silent-auth/") ||
    relPath === "/api/silent-auth" ||
    relPath === "/api/health" ||
    relPath === "/api/stripe/webhook" ||
    // Cross-origin donate (DonateModal in run.human/run.flash). The CORS
    // preflight OPTIONS carries no cookies BY SPEC, so gating it here 307s
    // the preflight → browsers reject redirected preflights → the modal
    // dies with "Failed to fetch" before the POST is ever sent. The route
    // enforces its own origin allowlist (OPTIONS) and session check
    // (POST → 401 + CORS headers), so it is safe to pass through.
    relPath === "/api/checkout/general";

  if (isWhitelisted) {
    return NextResponse.next();
  }

  if (!req.auth?.user) {
    // Not authenticated — redirect to signin, preserving basePath (e.g. /use1).
    const signinUrl = req.nextUrl.clone();
    signinUrl.pathname = `${REGION_BASEPATH}/signin`;
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
