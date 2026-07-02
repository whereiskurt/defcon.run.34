import { getSecureParam } from "./ssm";

/**
 * Admin gate — Phase 22-05-07 (Kurt 2026-07-02 rescope, Option A).
 *
 * Guards the admin-only API surface (currently
 * /api/admin/bib/pledged-unpaid). The allowlist lives at SSM param
 * `/dc34/secrets/use1/bib/admin/allowlist` as a String (comma-separated
 * OIDC `sub` values). Read at request time via getSecureParam's 5-min
 * cache, so rotating an admin off is at most 5 min out of date.
 *
 * Rationale for Option A over B (services.includes("admin") claim from
 * run.auth):
 *   - No run.auth PR + redeploy needed.
 *   - Admin list is bounded (single digits — Kurt + Jesse for MVP).
 *   - Environment separation is natural (SSM path is region-scoped).
 *
 * If the allowlist SSM param is missing OR empty, requireAdmin() denies
 * ALL callers (fail-closed). That's stricter than a soft-deny default —
 * we'd rather 403 in a misconfigured state than accidentally allow.
 */

const ADMIN_ALLOWLIST_SSM_PATH = "/dc34/secrets/use1/bib/admin/allowlist";
const ADMIN_ALLOWLIST_ENV_KEY = "BIB_ADMIN_ALLOWLIST";

/**
 * Parse a comma-separated allowlist string into a Set for O(1) lookup.
 *
 * Design contract:
 *   - Whitespace around entries is trimmed.
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
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

/**
 * Fetch the current admin allowlist, parsed into a Set.
 *
 * Env fallback (`BIB_ADMIN_ALLOWLIST`) is honored FIRST for dev/CI
 * convenience — matches the getSecureParam contract used by Stripe +
 * Anthropic keys. On any SSM error (missing param, IAM, network), the
 * caller receives an empty Set (fail-closed).
 *
 * Exported for tests + admin tooling that needs to introspect the
 * current list. In hot paths use {@link isAdmin} which combines the
 * fetch + membership check.
 */
export async function getAdminAllowlist(): Promise<Set<string>> {
  try {
    const raw = await getSecureParam({
      envKey: ADMIN_ALLOWLIST_ENV_KEY,
      ssmPath: ADMIN_ALLOWLIST_SSM_PATH,
    });
    return parseAdminAllowlist(raw);
  } catch {
    // Fail-closed: on any SSM/env failure, deny all admin access rather
    // than silently opening the endpoint. The caller's 403 log includes
    // the ownerSub so a misconfig is quickly visible.
    return new Set();
  }
}

/**
 * Test if `ownerSub` is on the admin allowlist. Returns `false` on any
 * SSM failure or empty allowlist (fail-closed).
 */
export async function isAdmin(ownerSub: string | null | undefined): Promise<boolean> {
  if (!ownerSub) return false;
  const allowlist = await getAdminAllowlist();
  return allowlist.has(ownerSub);
}

/**
 * Shape returned by {@link requireAdmin} to keep the caller's control
 * flow simple ("if !ok return 403"). We prefer a discriminated union
 * over throwing so the API route can render a proper JSON 403 without
 * try/catch noise.
 */
export type RequireAdminResult =
  | { ok: true; ownerSub: string }
  | { ok: false; reason: "no_session" | "not_allowlisted" };

/**
 * Route helper: given an Auth.js `session` (or null/undefined), decide
 * whether to admit the caller. Callers translate {ok:false} into an
 * appropriate 401 / 403 JSON response.
 *
 * Deliberately does NOT read the session itself — that's the route's
 * job (via `await auth()`). Keeping the SSM read local to this helper
 * makes it easy to reuse from any admin route in the future.
 */
export async function requireAdmin(
  session: { user?: { id?: string } } | null | undefined
): Promise<RequireAdminResult> {
  const ownerSub = session?.user?.id;
  if (!ownerSub) {
    return { ok: false, reason: "no_session" };
  }
  const admitted = await isAdmin(ownerSub);
  if (!admitted) {
    return { ok: false, reason: "not_allowlisted" };
  }
  return { ok: true, ownerSub };
}
