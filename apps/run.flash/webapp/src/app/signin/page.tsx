"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

// Loop guard. /signin auto-redirects to the IdP, and next-auth routes any
// interactive auth error back to /signin?error=… (and the silent bridge, on a
// top-level error, bounces here with the error preserved). Without a guard the
// auto-redirect re-fires immediately → authorize → error → /signin → … which
// the browser reports as "too many redirects, clear your cookies". So: ONE
// automatic attempt, then — if we just errored or already tried moments ago —
// stop and let the user retry by hand instead of looping.
const ATTEMPT_KEY = "dc_signin_attempt";
const ATTEMPT_WINDOW_MS = 15000;

export default function SignInPage() {
  const [needsManual, setNeedsManual] = useState(false);

  const buildCallbackUrl = () => {
    // Get region from URL path (e.g., /use1/signin -> use1). In production the
    // path is /{region}/signin; in local dev it is just /signin (no prefix).
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const firstSegment = pathParts[0] || "";
    const isRegion = /^(use1|cac1|usw2|euw1)$/.test(firstSegment);
    const region = isRegion ? firstSegment : "";
    return region ? `/${region}/` : "/";
  };

  const startSignIn = () => {
    try {
      sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()));
    } catch {
      // sessionStorage can throw (Safari private mode); the error param is still
      // a hard stop, so a missing marker only costs the "recently tried" arm.
    }
    signIn("run.defcon.run", { callbackUrl: buildCallbackUrl() });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasError = params.has("error");

    let lastAttempt = 0;
    try {
      lastAttempt = Number(sessionStorage.getItem(ATTEMPT_KEY) || 0);
    } catch {
      lastAttempt = 0;
    }
    const recentlyAttempted = Date.now() - lastAttempt < ATTEMPT_WINDOW_MS;

    // Bounced back from an error, or already auto-tried within the window ->
    // break the loop and show a manual retry instead of redirecting again.
    if (hasError || recentlyAttempted) {
      setNeedsManual(true);
      return;
    }

    startSignIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapStyle = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    backgroundColor: "#0a0a0f",
    color: "#e4e4ef",
  } as const;

  if (needsManual) {
    return (
      <div style={wrapStyle}>
        <div style={{ textAlign: "center", maxWidth: 320, padding: 16 }}>
          <p style={{ marginBottom: 16, fontFamily: "monospace" }}>
            We couldn&apos;t complete sign-in automatically.
          </p>
          <button
            onClick={() => {
              setNeedsManual(false);
              startSignIn();
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#16161f",
              color: "#e4e4ef",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <p style={{ fontFamily: "monospace" }}>Redirecting to DEF CON login...</p>
    </div>
  );
}
