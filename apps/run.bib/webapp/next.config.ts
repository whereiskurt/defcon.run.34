import type { NextConfig } from "next";

// Environment variables for regional deployment
const isDev = process.env.NODE_ENV !== "production";
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || "bib.defcon.run";
const WEBAPP_PREFIX = process.env.WEBAPP_PREFIX || "use1/assets";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

const nextConfig: NextConfig = {
  output: "standalone",

  // Mount app at /{region} path in production (e.g., /use1 or /cac1)
  // In dev, no basePath so local URLs stay simple.
  ...(isDev ? {} : { basePath: `/${REGION_SHORT}` }),

  // Asset prefix for CDN in production — rewrites <script> / <link> tags
  ...(isDev ? {} : { assetPrefix: `https://${WEBAPP_ORIGIN}/${WEBAPP_PREFIX}` }),

  // Expose region to client-side
  env: {
    NEXT_PUBLIC_REGION_SHORT: REGION_SHORT,
  },
};

export default nextConfig;
