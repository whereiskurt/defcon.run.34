/**
 * auth-email — resolve a runner's login email from run.auth by OIDC subject
 * (Kurt 2026-07-18).
 *
 * run.auth is the authoritative source of a runner's email (AuthProfile.email);
 * its internal validate endpoint now returns it. run.human needs it when
 * provisioning an Auth.js identity for a bib-only runner (see ensure-identity.ts)
 * — the adapter requires an email to mint the user, and run.human has none of its
 * own for someone who never signed in here.
 *
 * Mirrors fetchFreshClaims' internal-secret server-to-server call. Fail-open:
 * any non-2xx / network error / missing field yields null so a caller can decide
 * to skip provisioning rather than crash.
 */

import { config } from "@/config";

export async function getAuthEmailBySub(sub: string): Promise<string | null> {
  try {
    const url = `${config.urls.privateAuthServer}/api/session/validate/user/${encodeURIComponent(
      sub
    )}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": config.auth.internalSecret,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      valid?: boolean;
      user?: { email?: unknown };
    };
    const email = json.valid ? json.user?.email : undefined;
    return typeof email === "string" && email ? email : null;
  } catch {
    return null;
  }
}
