"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  SILENT_SSO_TIMEOUT_MS,
  decideParentAction,
  resolveRegion,
} from "@/lib/silent-sso";

/**
 * App-wide hidden-iframe silent-SSO probe.
 *
 * Gated on session status: the probe fires ONLY when the user is definitively
 * `unauthenticated`. While `loading` it does nothing; when `authenticated` it
 * renders nothing and injects no iframe — the hidden `prompt=none` probe must
 * never run on an already-authenticated route.
 *
 * When unauthenticated it injects one hidden iframe pointing at the initiator
 * route, listens for the same-origin bridge message (origin-verified via
 * decideParentAction), and arms a timeout. On `authenticated` it refreshes to the
 * authed view; on `login_required` it stays logged-out (LOCKED contract — no
 * redirect); on timeout it tears the iframe down and downgrades to the invisible
 * redirect fallback, returning the user to their current path.
 *
 * All specifics are literal-free: origin from `window.location.origin`, region from
 * the helper, paths built from the region.
 */
export default function SilentSSO() {
  const { status } = useSession();
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    // Gate: only probe when definitively logged out; never when authenticated.
    if (status !== "unauthenticated") return;
    if (startedRef.current) return;
    startedRef.current = true;

    const origin = window.location.origin;
    // resolveRegion is never empty (path region -> preferred-region cookie ->
    // default), so these auth URLs are always region-prefixed — never region-less
    // (a region-less /api/auth/* misroutes on region-mounted deployments).
    const region = resolveRegion(window.location.pathname, document.cookie);
    const initiator = `/${region}/api/auth/silent-signin`;
    const fallbackBase = `/${region}/api/auth/auto-signin`;
    // Where the user is now — the fallback returns them here (never a fixed path).
    const currentPath = window.location.pathname + window.location.search;

    // Hidden 0x0, aria-hidden, borderless probe iframe.
    const iframe = document.createElement("iframe");
    iframe.src = initiator;
    iframe.width = "0";
    iframe.height = "0";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:absolute;width:0;height:0;border:0;visibility:hidden;";

    let timer: ReturnType<typeof setTimeout> | undefined;

    const teardown = () => {
      window.removeEventListener("message", onMessage);
      if (timer !== undefined) clearTimeout(timer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const onMessage = (evt: MessageEvent) => {
      const action = decideParentAction(
        { origin: evt.origin, data: evt.data },
        origin,
      );
      if (action === "ignore") return;
      if (action === "authenticated") {
        teardown();
        router.refresh();
      } else {
        // "stay-logged-out": login_required -> stay logged out, no redirect.
        teardown();
      }
    };

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);

    timer = setTimeout(() => {
      // No decisive message in time: downgrade to the invisible redirect fallback,
      // navigating the top-level window and preserving the current location.
      teardown();
      window.location.assign(
        `${fallbackBase}?callbackUrl=${encodeURIComponent(currentPath)}`,
      );
    }, SILENT_SSO_TIMEOUT_MS);

    return teardown;
  }, [status, router]);

  return null;
}
