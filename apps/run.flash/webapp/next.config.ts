import type { NextConfig } from "next";

// Environment variables for regional deployment
const isDev = process.env.NODE_ENV !== "production";

if (!isDev && !process.env.NEXT_PUBLIC_FIRMWARE_VERSION) {
  throw new Error(
    "NEXT_PUBLIC_FIRMWARE_VERSION is empty. Production builds must inject the resolved Meshtastic stable version. " +
      "Set it via the Dockerfile.webapp builder ARG (FIRMWARE_VERSION -> ENV NEXT_PUBLIC_FIRMWARE_VERSION), or for local production builds run scripts/download-firmware.sh to populate .env.local."
  );
}

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
  ...(isDev ? {} : { basePath: `/${REGION_SHORT}` }),

  // Asset prefix for CDN in production - rewrites <script> / <link> tags
  // In dev, no assetPrefix needed
  ...(isDev ? {} : { assetPrefix: `https://${WEBAPP_ORIGIN}/${WEBAPP_PREFIX}` }),

  // Expose region to client-side
  // In local dev REGION_SHORT env is unset, so client code gets "" (no /use1/ prefix)
  // In Docker build REGION_SHORT is set via build-arg, so client gets "use1"
  env: {
    NEXT_PUBLIC_REGION_SHORT: process.env.REGION_SHORT || "",
    NEXT_PUBLIC_FIRMWARE_VERSION: process.env.NEXT_PUBLIC_FIRMWARE_VERSION || "",
  },
};

export default nextConfig;
