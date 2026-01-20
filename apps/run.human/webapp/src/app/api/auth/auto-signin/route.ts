import { signIn } from "@/config/auth";

/**
 * Auto-signin route for silent SSO.
 * This route handler triggers the OIDC flow server-side.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Don't add region prefix - signIn redirectTo respects basePath
  const callbackUrl = url.searchParams.get("callbackUrl") || "/dashboard";

  // Trigger the OIDC flow - signIn in a route handler is allowed
  await signIn("run.defcon.run", { redirectTo: callbackUrl });
}
