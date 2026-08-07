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

  // ── studio asset caching (fixed 2026-08-07) ────────────────────────────────
  // The studio ships ~100 files / 1.09 MB compressed behind 108 <link
  // rel=modulepreload> tags in app.html, and every single one was being
  // re-downloaded on every page load by every viewer. Two independent reasons,
  // and this fixes the second one:
  //
  //   1. CloudFront's /{region}/* catch-all uses Managed-CachingDisabled, so
  //      the edge never stored them (see modules/cloudfront — a dedicated
  //      behavior for this exact path now handles that half).
  //   2. Next serves everything out of public/ as `public, max-age=0`, so the
  //      BROWSER never stored them either — a plain reload refetched all 1.09 MB.
  //
  // `_app/immutable/` is SvelteKit's content-hashed output: the filename
  // changes whenever the bytes change, which is precisely the contract
  // `immutable` requires. Scoped to that subtree deliberately — app.html and
  // index.html live one level up under /studio/, are NOT content-hashed, and
  // must keep revalidating or a release would never reach anyone.
  async headers() {
    return [
      {
        // basePath is prepended automatically, so this matches
        // /use1/studio/_app/immutable/* in production.
        source: "/studio/_app/immutable/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },

  // GPX Studio frontend is built to public/studio/ and served as static files
  // With basePath, rewrites are relative to basePath (e.g., /use1/studio/app)
  async rewrites() {
    return [
      // Map /studio/app to /studio/app.html for clean URLs
      // Note: /studio and /studio/ redirect to /studio/app via middleware
      {
        source: "/studio/app",
        destination: "/studio/app.html",
      },
      // Map language routes (e.g., /studio/en/app) to their HTML files
      {
        source: "/studio/:lang/app",
        destination: "/studio/:lang/app.html",
      },
      // Proxy BRouter requests to avoid CORS issues. gpx.studio's own
      // brouter.gpx.studio host went dead (DNS ENOTFOUND) — repoint at the
      // canonical public BRouter (Kurt 2026-07-11). NB: the studio's custom
      // profile names are remapped to brouter.de's standard set in routing.ts.
      {
        source: "/api/brouter",
        destination: "https://brouter.de/brouter",
      },
      {
        source: "/api/brouter/:path*",
        destination: "https://brouter.de/brouter/:path*",
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
