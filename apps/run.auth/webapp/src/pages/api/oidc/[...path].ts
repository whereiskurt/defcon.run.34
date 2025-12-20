import type { NextApiRequest, NextApiResponse } from "next";
import { oidc } from "@/config/oidc";

/**
 * OIDC Provider Route Handler (Pages Router)
 *
 * Using Pages Router for cleaner integration with oidc-provider.
 * Pages Router provides native Node.js req/res objects that work
 * directly with oidc-provider's Koa-based callback.
 *
 * Handles all OIDC endpoints:
 * - /.well-known/openid-configuration (via /api/oidc/.well-known/openid-configuration)
 * - /auth (authorize)
 * - /token
 * - /me (userinfo)
 * - /jwks
 * - /token/revocation
 * - /token/introspection
 * - /session/end
 */

export const config = {
  api: {
    // Disable body parsing - oidc-provider handles it
    bodyParser: false,
    // Increase response size limit for JWKs
    responseLimit: false,
  },
};

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

// Route prefix must match oidc.ts configuration
// oidc-provider uses host + route for URL construction, so routes include the full path
const routePrefix = isDev ? "/api/oidc" : `/${REGION_SHORT}/api/oidc`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get the path segments after /api/oidc/
  const pathSegments = req.query.path as string[];
  // Build the full route path including prefix (oidc-provider routes are configured with full paths)
  // e.g., pathSegments = ["auth"] -> path = "/use1/api/oidc/auth" (prod) or "/api/oidc/auth" (dev)
  const path = routePrefix + "/" + (pathSegments?.join("/") || "");

  // Rewrite the URL to what oidc-provider expects
  // Routes are configured with full paths (e.g., /use1/api/oidc/auth in production)
  req.url = path + (req.url?.includes("?") ? req.url.substring(req.url.indexOf("?")) : "");

  try {
    // Intercept redirects to add region prefix for CloudFront routing
    // Auth.js doesn't include Next.js basePath in callback URLs, so we need to fix them
    const originalWriteHead = res.writeHead.bind(res);
    const originalSetHeader = res.setHeader.bind(res);

    const fixRedirectUrl = (url: string): string => {
      // Only fix redirects to /api/auth/callback that are missing the region prefix (e.g., /use1/, /cac1/)
      // Pattern matches URLs with /api/auth/callback NOT preceded by a region prefix like /use1/ or /cac1/
      if (!isDev && url && url.includes("/api/auth/callback") && !/\/[a-z]{3}\d\/api\/auth\/callback/.test(url)) {
        return url.replace(
          "/api/auth/callback",
          `/${REGION_SHORT}/api/auth/callback`
        );
      }
      return url;
    };

    res.setHeader = (name: string, value: string | number | readonly string[]) => {
      if (name.toLowerCase() === "location" && typeof value === "string") {
        return originalSetHeader(name, fixRedirectUrl(value));
      }
      return originalSetHeader(name, value);
    };

    res.writeHead = (statusCode: number, ...args: any[]) => {
      // Check if headers object contains Location
      const headers = args.find(arg => typeof arg === "object" && arg !== null);
      if (headers && headers.Location) {
        headers.Location = fixRedirectUrl(headers.Location);
      }
      if (headers && headers.location) {
        headers.location = fixRedirectUrl(headers.location);
      }
      return originalWriteHead(statusCode, ...args);
    };

    // Get the Koa callback from oidc-provider
    const callback = oidc.callback();

    // oidc-provider's callback expects (req, res) and returns a Promise
    await callback(req as any, res as any);
  } catch (error: any) {
    console.error("OIDC handler error:", error);

    // If headers haven't been sent, send error response
    if (!res.headersSent) {
      res.status(error.status || 500).json({
        error: "server_error",
        error_description: error.message || "An unexpected error occurred",
      });
    }
  }
}
