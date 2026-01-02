import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware to pass the current URL to server components via headers.
 * This enables layouts to check for query parameters like autoLogin.
 */
export function middleware(request: NextRequest) {
  // Clone the request headers and add x-url
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-url", request.url);

  // Return response with modified headers
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

// Only run on public routes where silent SSO is needed
export const config = {
  matcher: ["/", "/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
