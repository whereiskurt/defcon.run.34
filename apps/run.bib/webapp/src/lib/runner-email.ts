/**
 * Runner login-email resolver for run.bib (Kurt 2026-07-18).
 *
 * A bib stores only `ownerSub` (the OIDC subject) — run.bib uses pure-JWT
 * sessions with NO database adapter, so it never persists the login email. The
 * authoritative source is run.auth: every bib owner authenticated through it,
 * and it holds their email on AuthProfile keyed by that exact OIDC subject
 * (run.bib's ownerSub == AuthProfile.userId — the same id bib already sends to
 * `/api/session/validate/user/{sub}` for session claims).
 *
 * Used ONLY by the admin print-names CSV enrichment (the bib-vendor handoff).
 * Previously the CSV joined email from run.human, which only has it if the
 * runner ALSO used the main app — so runners who only ever used bib.defcon.run
 * came out blank. run.auth has an email for every bib.
 *
 * Fail-open: any non-2xx / network error / missing field resolves to null so a
 * slow or down run.auth never breaks the CSV download (blank cell, never a 500).
 * Mirrors config/auth.ts's internal-URL derivation + X-Internal-Secret pattern.
 */

const isDev = process.env.NODE_ENV !== "production";

/** run.auth internal base URL — env override, else service discovery (prod) /
 *  localhost (dev). Read at call time so env overrides + tests apply. */
function authBaseUrl(): string {
  const region = process.env.REGION_SHORT || "use1";
  const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
  const localAuthPort = process.env.LOCAL_AUTH_PORT || "3002";
  return (
    process.env.AUTH_INTERNAL_URL ||
    (isDev
      ? `http://localhost:${localAuthPort}`
      : `http://run-auth.app-${region}-${siteDomain.replace(
          /\./g,
          "-"
        )}.local:3000/${region}`)
  );
}

/**
 * Resolve a runner's login email from run.auth by OIDC subject (== bib ownerSub).
 * Returns the email string, or null on any miss / error (fail-open).
 */
export async function getRunnerEmail(ownerSub: string): Promise<string | null> {
  try {
    const url = `${authBaseUrl()}/api/session/validate/user/${encodeURIComponent(
      ownerSub
    )}`;
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.AUTH_INTERNAL_SECRET || "",
      },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      valid?: boolean;
      user?: { email?: unknown };
    };
    const email = json.valid ? json.user?.email : undefined;
    return typeof email === "string" && email ? email : null;
  } catch {
    // A lookup miss must never break the CSV download — leave the cell blank.
    return null;
  }
}
