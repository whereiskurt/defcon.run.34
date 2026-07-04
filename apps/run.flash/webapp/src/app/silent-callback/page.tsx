"use client";

import { useEffect } from "react";
import {
  SILENT_SSO_MESSAGE_TYPE,
  regionFromPath,
  resolveSilentStatus,
} from "@/lib/silent-sso";

/**
 * Same-origin silent-SSO bridge page.
 *
 * The iframe lands here after a `prompt=none` authorize (or after next-auth's
 * `pages.error` redirect for a negative). It reports the resolved outcome to the
 * parent via postMessage, targeting the app's OWN origin explicitly (never "*").
 * When loaded top-level (not framed) it falls through to the normal sign-in page,
 * so reusing this route as `pages.error` is safe outside the iframe.
 */
export default function SilentCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = resolveSilentStatus(params);

    if (window.parent !== window) {
      // Framed: report to the parent, targeting the explicit same origin only.
      window.parent.postMessage(
        { type: SILENT_SSO_MESSAGE_TYPE, status },
        window.location.origin,
      );
      return;
    }

    // Top-level load (e.g. pages.error reached outside the iframe): behave normally
    // by continuing to the region-prefixed sign-in page.
    const region = regionFromPath(window.location.pathname);
    window.location.replace(region ? `/${region}/signin` : "/signin");
  }, []);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        backgroundColor: "#1a1a1a",
        color: "#fff",
      }}
    >
      <p>Completing sign-in...</p>
    </div>
  );
}
