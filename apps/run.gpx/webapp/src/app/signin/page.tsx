"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignInPage() {
  useEffect(() => {
    // Get region from URL path (e.g., /use1/signin -> use1)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const region = pathParts[0] || '';

    // Build callback URL with region prefix
    // In production: /use1/studio, in dev: /studio
    const callbackUrl = region ? `/${region}/studio` : "/studio";

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
      <p>Redirecting to DEF CON login...</p>
    </div>
  );
}
