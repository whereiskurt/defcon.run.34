/**
 * Admin gate — v1.6 (Kurt 2026-07-03): group-claim based.
 *
 * Admin access is granted via the `"admin"` entry in the user's `services`
 * list — the run.auth AuthProfile "groups" model — surfaced on the Auth.js
 * session as `session.user.services: string[]`. This mirrors run.human's
 * canonical admin check (`session.user.services.includes("admin")`) so all
 * apps gate admin the same way.
 *
 * Supersedes the Phase 22-05 SSM email allowlist. The `services` claim flows
 * to the session via the `services` OIDC scope (already requested by the bib
 * client) and refreshes every ~5 min, so granting/revoking `"admin"` on a
 * user's AuthProfile in `run-auth-electro` propagates to their live session
 * without a redeploy.
 */

export type SessionLike =
  | {
      user?: { services?: string[] | null; email?: string | null } | null;
    }
  | null
  | undefined;

/**
 * True iff the session carries the `"admin"` service/group. Pure + sync so
 * server components and API routes can gate without an async hop.
 */
export function isAdmin(session: SessionLike): boolean {
  const services = session?.user?.services;
  return Array.isArray(services) && services.includes("admin");
}

/**
 * Discriminated result so callers keep simple control flow and map the
 * failure reason to the right HTTP status:
 *   - `no_session`  → 401 (unauthenticated)
 *   - `not_admin`   → 403 (authenticated, lacks the "admin" group)
 */
export type RequireAdminResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: "no_session" | "not_admin" };

/**
 * Route/page helper: given an Auth.js `session` (or null), decide whether
 * to admit the caller. Deliberately does NOT read the session itself —
 * that's the caller's job (via `await auth()`).
 */
export function requireAdmin(session: SessionLike): RequireAdminResult {
  if (!session?.user) {
    return { ok: false, reason: "no_session" };
  }
  if (!isAdmin(session)) {
    return { ok: false, reason: "not_admin" };
  }
  return { ok: true, email: session.user.email ?? null };
}
