import { signIn } from "@/config/auth";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

/**
 * Silent-SSO initiator route.
 *
 * Triggers a `prompt=none` authorize inside the hidden iframe. The third `signIn`
 * argument (authorizationParams) is how `prompt=none` reaches the authorize URL.
 * On the happy path next-auth consumes the code at its own callback and lands the
 * iframe on the same-origin `/silent-callback` bridge; on a negative next-auth
 * redirects to `pages.error` (also the bridge).
 */
export async function GET() {
  // Region-prefixed in production, bare in dev (matches next-auth redirect basePath).
  const redirectTo = isDev ? "/silent-callback" : `/${REGION_SHORT}/silent-callback`;

  await signIn("run.defcon.run", { redirectTo }, { prompt: "none" });
}
