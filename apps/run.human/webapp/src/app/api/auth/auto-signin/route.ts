import { redirect } from "next/navigation";
import { signIn } from "@/config/auth";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

/**
 * Auto-signin route for silent SSO.
 * This route handler triggers the OIDC flow server-side.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get("callbackUrl") ||
    (isDev ? "/dashboard" : `/${REGION_SHORT}/dashboard`);

  // Trigger the OIDC flow - signIn in a route handler is allowed
  await signIn("run.defcon.run", { redirectTo: callbackUrl });
}
