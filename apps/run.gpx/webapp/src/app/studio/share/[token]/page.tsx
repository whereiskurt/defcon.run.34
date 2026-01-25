"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

/**
 * Share page - redirects to GPX Studio app with share token as query param.
 * The GPX Studio app handles the share acceptance dialog.
 */
export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  useEffect(() => {
    if (token) {
      // In production, we need the region prefix (e.g., /use1)
      // NODE_ENV is embedded at build time and available client-side
      const isDev = process.env.NODE_ENV !== "production";
      const regionShort = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
      const basePath = isDev ? "" : `/${regionShort}`;

      // Redirect to GPX Studio app with share token
      window.location.href = `${basePath}/studio/app?share=${encodeURIComponent(token)}`;
    }
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading shared file...</p>
      </div>
    </div>
  );
}
