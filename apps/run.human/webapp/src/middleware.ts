import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { findDuplicateAuthCookies } from "@/lib/legacy-cookie-cleanup";

// Read directly from env (not the full config module) to keep the middleware
// bundle minimal. Matches the AUTH_COOKIE_DOMAIN the cookies were written with.
const LEGACY_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN;

/**
 * Middleware to pass the current URL to server components via headers.
 * This enables layouts to check for query parameters like autoLogin.
 */
export function middleware(request: NextRequest) {
  // Clone the request headers and add x-url
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-url", request.url);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Auth cookies are host-only now, but browsers that still hold a legacy
  // `.defcon.run`-scoped copy send both — and the older legacy copy is ordered
  // first, shadowing the live cookie (stale-session redirect loops). A
  // duplicated name in the raw Cookie header is the only server-visible tell;
  // delete the legacy variant when we see one. Deleting by name+domain+path
  // can never touch the host-only cookie.
  if (LEGACY_COOKIE_DOMAIN) {
    for (const name of findDuplicateAuthCookies(request.headers.get("cookie"))) {
      response.cookies.set(name, "", {
        domain: LEGACY_COOKIE_DOMAIN,
        path: "/",
        maxAge: 0,
        secure: true,
      });
    }
  }

  return response;
}

// Only run on public routes where silent SSO is needed
export const config = {
  matcher: ["/", "/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
