"use client";

import { useEffect } from "react";
import {
  SILENT_SSO_MESSAGE_TYPE,
  resolveRegion,
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
    // by continuing to the sign-in page. resolveRegion is never empty, so this is
    // always region-prefixed — never a region-less /signin (which misroutes).
    //
    // Preserve any next-auth `error` param so /signin knows this was a FAILED
    // attempt and must NOT auto-retry signIn() (which would re-error and bounce
    // straight back here — the /silent-callback <-> /signin "too many redirects"
    // loop). /signin's loop guard renders a manual retry instead.
    const region = resolveRegion(window.location.pathname, document.cookie);
    const error = params.get("error");
    const target = error
      ? `/${region}/signin?error=${encodeURIComponent(error)}`
      : `/${region}/signin`;
    window.location.replace(target);
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
