import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Rewrite /gpx/* to serve the gpx.studio frontend from public/gpx/
  async rewrites() {
    return [
      {
        source: "/gpx/:path*",
        destination: "/gpx/:path*",
      },
    ];
  },
};

export default nextConfig;
