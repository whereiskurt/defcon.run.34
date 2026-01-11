import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // GPX Studio frontend is built to public/gpx-studio/ and served as static files
  // The app route at /studio uses Next.js pages to wrap the frontend with auth
  async rewrites() {
    return [
      // Serve gpx.studio static assets from the built frontend
      {
        source: "/gpx-studio/:path*",
        destination: "/gpx-studio/:path*",
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
