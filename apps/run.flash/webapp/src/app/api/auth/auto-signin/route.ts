import { signIn } from "@/config/auth";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

/**
 * Redirect-based auto-signin fallback for silent SSO.
 *
 * This is the safety net, not the primary path: it fires only when the hidden
 * iframe times out. It is invisible for an already-authenticated user thanks to
 * the IdP server-side interaction change (plan 33-01). The caller (SilentSSO)
 * supplies the current region-prefixed path as `callbackUrl` so the user is
 * returned to where they were; the default falls back to the region root.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Default to the region root (never an app-specific landing path).
  const defaultCallback = isDev ? "/" : `/${REGION_SHORT}/`;
  const callbackUrl = url.searchParams.get("callbackUrl") || defaultCallback;

  await signIn("run.defcon.run", { redirectTo: callbackUrl });
}
