"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignInPage() {
  useEffect(() => {
    // Auto-redirect to OIDC provider
    signIn("run.defcon.run", { callbackUrl: "/" });
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
