import { getSecureParam } from "./ssm";

/**
 * Admin gate — Phase 22-05-07 (Kurt 2026-07-02 rescope, Option A).
 *
 * Guards the admin-only API surface (currently
 * /api/admin/bib/pledged-unpaid). The allowlist lives at SSM param
 * `/dc34/secrets/use1/bib/admin/allowlist` as a String — a comma-separated
 * list of **email addresses** (case-insensitive). Compared against the
 * OIDC `email` claim on the Auth.js session.
 *
 * Cache model (Kurt 2026-07-02 correction):
 *   Read ONCE at first call and cached indefinitely at the module scope.
 *   Container restart on redeploy is the refresh point. A per-request SSM
 *   lookup would tax every admin request with a network hop; a bounded
 *   allowlist that only changes on personnel changes doesn't need it.
 *
 * If the allowlist SSM param is missing OR empty, requireAdmin() denies
 * ALL callers (fail-closed).
 */

const ADMIN_ALLOWLIST_SSM_PATH = "/dc34/secrets/use1/bib/admin/allowlist";
const ADMIN_ALLOWLIST_ENV_KEY = "BIB_ADMIN_ALLOWLIST";

let _allowlistPromise: Promise<Set<string>> | null = null;

/**
 * Parse a comma-separated allowlist string into a lowercased email Set.
 *
 * Design contract:
 *   - Whitespace around entries is trimmed.
 *   - Emails are lowercased (case-insensitive comparison).
 *   - Empty entries (e.g., "a,,b") are dropped.
 *   - Duplicate entries collapse (Set semantics).
 *   - An empty input returns an empty Set (fail-closed at the callsite).
 *
 * Exported so tests can pin the parse rules without touching SSM.
 */
export function parseAdminAllowlist(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

/**
 * Fetch the current admin allowlist, parsed into a Set. Cached at module
 * scope after the first successful call — subsequent calls return the
 * same Set without re-hitting SSM.
 *
 * Env fallback (`BIB_ADMIN_ALLOWLIST`) is honored FIRST for dev/CI.
 * On any SSM error the caller receives an empty Set (fail-closed) and
 * the failed result is NOT cached — the next call retries so a transient
 * SSM/IAM outage recovers without a container restart.
 */
export async function getAdminAllowlist(): Promise<Set<string>> {
  if (_allowlistPromise !== null) {
    return _allowlistPromise;
  }
  const attempt = (async (): Promise<Set<string>> => {
    const raw = await getSecureParam({
      envKey: ADMIN_ALLOWLIST_ENV_KEY,
      ssmPath: ADMIN_ALLOWLIST_SSM_PATH,
    });
    return parseAdminAllowlist(raw);
  })();
  // Only cache successful results; a rejection lets the next call retry.
  _allowlistPromise = attempt.catch(() => {
    _allowlistPromise = null;
    return new Set<string>();
  });
  return _allowlistPromise;
}

/**
 * Reset the cached allowlist. Test-only escape hatch — production has no
 * runtime need to invalidate (a container restart on redeploy is the
 * intended refresh mechanism).
 */
export function _resetAdminAllowlistCacheForTests(): void {
  _allowlistPromise = null;
}

/**
 * Test if `email` is on the admin allowlist. Case-insensitive.
 * Returns `false` on missing input or empty allowlist (fail-closed).
 */
export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const allowlist = await getAdminAllowlist();
  return allowlist.has(email.trim().toLowerCase());
}

/**
 * Shape returned by {@link requireAdmin} to keep the caller's control
 * flow simple. We prefer a discriminated union over throwing so the API
 * route can render a proper JSON 403 without try/catch noise.
 */
export type RequireAdminResult =
  | { ok: true; email: string }
  | { ok: false; reason: "no_session" | "not_allowlisted" };

/**
 * Route helper: given an Auth.js `session` (or null/undefined), decide
 * whether to admit the caller by email. Callers translate {ok:false}
 * into an appropriate 401 / 403 JSON response.
 *
 * Deliberately does NOT read the session itself — that's the route's
 * job (via `await auth()`).
 */
export async function requireAdmin(
  session: { user?: { email?: string | null } } | null | undefined
): Promise<RequireAdminResult> {
  const email = session?.user?.email ?? undefined;
  if (!email) {
    return { ok: false, reason: "no_session" };
  }
  const admitted = await isAdmin(email);
  if (!admitted) {
    return { ok: false, reason: "not_allowlisted" };
  }
  return { ok: true, email: email.trim().toLowerCase() };
}
