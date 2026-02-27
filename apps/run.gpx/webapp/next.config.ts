import type { NextConfig } from "next";

// Environment variables for regional deployment
const isDev = process.env.NODE_ENV !== "production";
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || "gpx.defcon.run";
const WEBAPP_PREFIX = process.env.WEBAPP_PREFIX || "use1/assets";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

const nextConfig: NextConfig = {
  output: "standalone",

  // Mount app at /{region} path in production (e.g., /use1 or /cac1)
  // In dev, no basePath so GPX Studio's absolute paths work correctly
  ...(isDev ? {} : { basePath: `/${REGION_SHORT}` }),

  // Asset prefix for CDN in production - rewrites <script> / <link> tags
  // In dev, no assetPrefix needed
  ...(isDev ? {} : { assetPrefix: `https://${WEBAPP_ORIGIN}/${WEBAPP_PREFIX}` }),

  // GPX Studio frontend is built to public/studio/ and served as static files
  // With basePath, rewrites are relative to basePath (e.g., /use1/studio/app)
  async rewrites() {
    return [
      // Map /studio and /studio/ to /studio/app.html (main entry point)
      // Note: These paths are relative to basePath, so actual URL is /{region}/studio
      {
        source: "/studio",
        destination: "/studio/app.html",
      },
      {
        source: "/studio/",
        destination: "/studio/app.html",
      },
      // Map /studio/app to /studio/app.html for clean URLs
      {
        source: "/studio/app",
        destination: "/studio/app.html",
      },
      // Map language routes (e.g., /studio/en/app) to their HTML files
      {
        source: "/studio/:lang/app",
        destination: "/studio/:lang/app.html",
      },
      // Proxy BRouter requests to avoid CORS issues
      {
        source: "/api/brouter",
        destination: "https://brouter.gpx.studio/",
      },
      {
        source: "/api/brouter/:path*",
        destination: "https://brouter.gpx.studio/:path*",
      },
    ];
  },

  // Allow Mapbox and S3 image/tile sources
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.mapbox.com" },
      { protocol: "https", hostname: "*.s3.amazonaws.com" },
    ],
  },

  // Expose region to client-side
  env: {
    NEXT_PUBLIC_REGION_SHORT: REGION_SHORT,
  },
};

export default nextConfig;
