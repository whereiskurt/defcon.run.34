import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // GPX Studio frontend is built to public/gpx-studio/ and served as static files
  // The app route at /studio uses Next.js pages to wrap the frontend with auth
  async rewrites() {
    return [
      // Map /gpx-studio/app to /gpx-studio/app.html for clean URLs
      {
        source: "/gpx-studio/app",
        destination: "/gpx-studio/app.html",
      },
      // Map language routes (e.g., /gpx-studio/en/app) to their HTML files
      {
        source: "/gpx-studio/:lang/app",
        destination: "/gpx-studio/:lang/app.html",
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
