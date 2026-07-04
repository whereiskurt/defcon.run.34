/**
 * Silent-SSO pure helper unit.
 *
 * Framework-agnostic and app-agnostic: this module imports nothing from the app
 * config or from next-auth, and contains no app-specific literals. It is the
 * canonical copy that is placed byte-identically into every full-user NextAuth RP
 * (gpx / flash / bib) and guarded by a parity test.
 */

/** postMessage discriminator used by the /silent-callback bridge -> parent listener. */
export const SILENT_SSO_MESSAGE_TYPE = "silent-sso";

/** Iframe teardown / fallback timeout (~4.5s). */
export const SILENT_SSO_TIMEOUT_MS = 4500;

export type SilentStatus = "success" | "login_required";

/** First path segment shapes that are recognised as a deployment region prefix. */
const REGION_RE = /^(use1|cac1|usw2|euw1)$/;

/**
 * OIDC negative `prompt=none` responses. Every one of these normalises to
 * login_required. next-auth surfaces them via its own `error` param, but we also
 * match them defensively in case a raw OIDC negative reaches the bridge directly.
 */
const OIDC_NEGATIVE_PARAMS = [
  "login_required",
  "interaction_required",
  "consent_required",
  "access_denied",
] as const;

/**
 * Resolve the silent-SSO outcome from the /silent-callback landing URL params.
 *
 * The RP is a next-auth@5 OIDC client, NOT a raw OIDC callback. On a successful
 * `prompt=none` authorize, next-auth consumes the authorization `code` at its OWN
 * callback (`/api/auth/callback/<provider>`), sets the app session cookie, then
 * redirects to `redirectTo` (= `/silent-callback`) with NO `error` param — success
 * lands param-less. On any failure next-auth redirects to `pages.error`
 * (= `/silent-callback`) with `?error=<AuthErrorType>` (confirmed against
 * @auth/core: `Response.redirect(`${origin}${pagePath}?${new URLSearchParams({ error: type })}`)`).
 *
 * Therefore success is keyed on the ABSENCE of the next-auth `error` param — it is
 * NOT keyed on the presence of a `code` param (next-auth already consumed `code`),
 * which would misclassify every real success as login_required.
 */
export function resolveSilentStatus(params: URLSearchParams): SilentStatus {
  // Primary signal: next-auth appends `?error=<type>` on every failure redirect.
  if (params.has("error")) return "login_required";
  // Defensive: a raw OIDC negative arriving as its own key also means logged-out.
  for (const neg of OIDC_NEGATIVE_PARAMS) {
    if (params.has(neg)) return "login_required";
  }
  // No error param -> next-auth already completed its callback and set the app
  // session cookie; the param-less landing is the real success shape.
  return "success";
}

/** Region prefix derived from a pathname first segment, or "" when none. */
export function regionFromPath(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0] || "";
  return REGION_RE.test(first) ? first : "";
}

/** Region-prefixed `/silent-callback` path (bare when no region prefix present). */
export function silentCallbackPath(pathname: string): string {
  const region = regionFromPath(pathname);
  return region ? `/${region}/silent-callback` : "/silent-callback";
}

/**
 * Decide how the parent window should react to a cross-frame message.
 *
 * Returns "ignore" unless the event originates from the app's own origin AND the
 * message is a well-formed silent-sso message. success -> authenticated;
 * login_required -> stay-logged-out. The origin check is the anti-spoofing
 * security invariant — the parent never acts on foreign-origin messages.
 */
export function decideParentAction(
  evt: { origin: string; data: unknown },
  expectedOrigin: string,
): "authenticated" | "stay-logged-out" | "ignore" {
  if (evt.origin !== expectedOrigin) return "ignore";
  const data = evt.data;
  if (typeof data !== "object" || data === null) return "ignore";
  const msg = data as { type?: unknown; status?: unknown };
  if (msg.type !== SILENT_SSO_MESSAGE_TYPE) return "ignore";
  if (msg.status === "success") return "authenticated";
  if (msg.status === "login_required") return "stay-logged-out";
  return "ignore";
}
