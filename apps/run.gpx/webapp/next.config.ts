import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // GPX Studio frontend is built to public/studio/ and served as static files
  // The app route at /studio uses Next.js pages to wrap the frontend with auth
  async rewrites() {
    return [
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
    ];
  },

  // Allow Mapbox and S3 image/tile sources
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.mapbox.com" },
      { protocol: "https", hostname: "*.s3.amazonaws.com" },
    ],
  },
};

export default nextConfig;
