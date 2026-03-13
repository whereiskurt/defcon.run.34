import type { NextConfig } from "next";

// Environment variables for regional deployment
const isDev = process.env.NODE_ENV !== "production";
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || "flash.defcon.run";
const WEBAPP_PREFIX = process.env.WEBAPP_PREFIX || "use1/assets";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

const nextConfig: NextConfig = {
  output: "standalone",

  // @meshtastic/core imports { formatWithOptions, types } from "util"
  // which doesn't exist in browsers. Custom shim provides stubs.
  turbopack: {
    resolveAlias: {
      util: "./src/lib/util-shim.js",
    },
  },

  trailingSlash: true,

  // Mount app at /{region} path in production (e.g., /use1 or /cac1)
  // In dev, no basePath so development works at root
  // Uses REGION_SHORT env var presence (not NODE_ENV) since Docker builds may not set NODE_ENV
  ...(process.env.REGION_SHORT ? { basePath: `/${REGION_SHORT}` } : {}),

  // Asset prefix for CDN in production - rewrites <script> / <link> tags
  // In dev, no assetPrefix needed
  ...(process.env.REGION_SHORT ? { assetPrefix: `https://${WEBAPP_ORIGIN}/${WEBAPP_PREFIX}` } : {}),

  // Expose region to client-side
  // Empty when no basePath (local dev), otherwise matches REGION_SHORT
  env: {
    NEXT_PUBLIC_REGION_SHORT: process.env.REGION_SHORT || "",
  },
};

export default nextConfig;
