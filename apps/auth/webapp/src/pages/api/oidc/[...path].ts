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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get the path segments after /api/oidc/
  const pathSegments = req.query.path as string[];
  const path = "/" + (pathSegments?.join("/") || "");

  // Rewrite the URL to what oidc-provider expects
  // oidc-provider paths are relative to issuer (e.g., /auth, /token, /.well-known/openid-configuration)
  const originalUrl = req.url;
  req.url = path + (req.url?.includes("?") ? req.url.substring(req.url.indexOf("?")) : "");

  try {
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
