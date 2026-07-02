"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignInPage() {
  useEffect(() => {
    // Get region from URL path (e.g., /use1/signin -> use1)
    // In production, the path is /{region}/signin, so pathParts[0] is the region
    // In local dev, the path is just /signin, so there's no region prefix
    const pathParts = window.location.pathname.split('/').filter(Boolean);

    // Check if first segment looks like a region (use1, cac1, etc.) vs a route (signin)
    const firstSegment = pathParts[0] || '';
    const isRegion = /^(use1|cac1|usw2|euw1|apse1)$/.test(firstSegment);
    const region = isRegion ? firstSegment : '';

    // Build callback URL with region prefix
    // In production: /use1/, in dev: /
    const callbackUrl = region ? `/${region}/` : "/";

    // Auto-redirect to OIDC provider
    signIn("run.defcon.run", { callbackUrl });
  }, []);

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100vh",
      backgroundColor: "#1a1a1a",
      color: "#fff"
    }}>
      <p>Redirecting to defcon.run login...</p>
    </div>
  );
}
