import type { NextApiRequest, NextApiResponse } from "next";
import { oidc } from "@/config/oidc";

/**
 * OIDC Discovery Endpoint
 * Handles /.well-known/openid-configuration
 *
 * This is a separate route because Next.js catch-all routes
 * don't reliably match paths starting with a dot.
 */

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // oidc-provider expects the path relative to issuer, which includes /api/oidc
  // The discovery endpoint is at /.well-known/openid-configuration relative to issuer
  req.url = "/.well-known/openid-configuration";

  try {
    const callback = oidc.callback();
    await callback(req as any, res as any);
  } catch (error: any) {
    console.error("OIDC discovery error:", error);
    if (!res.headersSent) {
      res.status(error.status || 500).json({
        error: "server_error",
        error_description: error.message || "An unexpected error occurred",
      });
    }
  }
}
