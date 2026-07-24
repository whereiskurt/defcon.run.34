/**
 * run.human shared admin gate (ADMN-01).
 *
 * Group-claim based, mirroring run.bib `lib/admin-gate.ts`: admin access is
 * granted ONLY via the `"admin"` entry in the user's `services` list — the
 * run.auth AuthProfile "groups" model, surfaced on the Auth.js session as
 * `session.user.services: string[]`. There is NO email allowlist and no other
 * grant source (threat T-43-01).
 *
 * One primitive for the whole phase: page, API, and CSV surfaces all import
 * `requireAdmin` (sync) + `revalidateAdmin` (async) from here so every admin
 * entry gates identically.
 *
 * ── Caller contract (non-disclosure, threat T-43-02) ────────────────────────
 * Denial MUST map to a 404, NEVER a 403 — the admin route's existence is not
 * advertised to non-admins:
 *   - Server component / page:  if (!ok) notFound();
 *   - Route handler / API:      return new Response(null, { status: 404 });
 *
 * ── /admin entry contract (staleness, threat T-43-06) ───────────────────────
 * The sync `requireAdmin(session)` check trusts the cached JWT `services`. On
 * `/admin` entry, callers MUST ALSO await `revalidateAdmin(session.user.id)`
 * AFTER `requireAdmin` passes — this hits run.auth for LIVE claims and denies a
 * just-revoked admin lingering inside the ~5-min JWT staleness window. It is
 * fail-closed (auth-server error → deny).
 *
 * This module is deliberately FRAMEWORK-NEUTRAL: it imports no Next.js
 * `notFound()`/`redirect()`, so both server components and route handlers can
 * consume it. Translating the result into an HTTP 404 is the caller's job.
 */

// Single source of the fresh-claims revalidation (reuses the internal-secret
// validate path in config/auth.ts). Re-exported here so callers import both the
// sync and async halves of the gate from one module.
export { revalidateAdmin, revalidateGroups } from "@/config/auth";

export type SessionLike =
  | {
      user?: { services?: string[] | null; email?: string | null } | null;
    }
  | null
  | undefined;

/**
 * Groups that grant admin-console access. Membership in ANY of these on the
 * user's `services` list opens the gate. Kept as ONE list so the nav link, the
 * page/API gate, and the live `revalidateAdmin` all agree on who is an admin.
 * (`runadmin` = run.human operators; `admin` = full superuser.)
 */
export const ADMIN_GROUPS = ["admin", "runadmin"] as const;

/**
 * Groups allowed to use the QR sheet designer. Superset of ADMIN_GROUPS:
 * `qradmin` members are sheet-printing operators. Deliberately, qradmin does
 * NOT open ANYTHING under /admin/* or /api/admin/* (edge/WAF rules may wall
 * that whole area off) — this list gates the /user/qr/sheet twin, and
 * /admin/qr/sheet uses it only to BOUNCE a qradmin-only visitor over there.
 */
export const QR_ADMIN_GROUPS = [...ADMIN_GROUPS, "qradmin"] as const;

/**
 * Groups allowed to use the CTF operator override (re-submit an already-solved
 * flag to test challenge setups — see judgeSolve `admin`). Superset of
 * ADMIN_GROUPS with a dedicated `ctfadmin` slot. NOTE: `ctfadmin` is not a group
 * that run.auth issues today; it is listed here so the override lights up
 * automatically if/when that group is added — `admin`/`runadmin` are the
 * effective gates now. This grants NO data access, only a re-submit of the
 * operator's OWN flag, so the sync session check (no live revalidation) suffices.
 */
export const CTF_ADMIN_GROUPS = [...ADMIN_GROUPS, "ctfadmin"] as const;

/** True iff the session carries ANY of `groups` on its services list. */
export function isMemberOf(
  session: SessionLike,
  groups: readonly string[]
): boolean {
  const services = session?.user?.services;
  return Array.isArray(services) && services.some((s) => groups.includes(s));
}

/**
 * True iff the session carries one of the ADMIN_GROUPS service/groups. Pure +
 * sync so server components and API routes can gate without an async hop.
 */
export function isAdmin(session: SessionLike): boolean {
  return isMemberOf(session, ADMIN_GROUPS);
}

/**
 * True iff the session may run QR operator features (QR_ADMIN_GROUPS):
 * attendance mode in the camera scanner + its daily-cap exemption.
 */
export function isQrAdmin(session: SessionLike): boolean {
  return isMemberOf(session, QR_ADMIN_GROUPS);
}

/**
 * True iff the session may use the CTF operator override (CTF_ADMIN_GROUPS).
 * Pure + sync — the CTF front doors call it to decide whether to pass
 * `admin: true` into judgeSolve.
 */
export function isCtfAdmin(session: SessionLike): boolean {
  return isMemberOf(session, CTF_ADMIN_GROUPS);
}

/**
 * Discriminated result so callers keep simple control flow. NOTE: per the
 * non-disclosure contract above, callers map BOTH failure reasons to a 404
 * (never 401/403) on admin surfaces so route existence is not leaked.
 *   - `no_session`  → unauthenticated
 *   - `not_admin`   → authenticated, lacks the "admin" group
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
  return requireGroups(session, ADMIN_GROUPS);
}

/** Group-parameterized twin of requireAdmin — same result contract. */
export function requireGroups(
  session: SessionLike,
  groups: readonly string[]
): RequireAdminResult {
  if (!session?.user) {
    return { ok: false, reason: "no_session" };
  }
  if (!isMemberOf(session, groups)) {
    return { ok: false, reason: "not_admin" };
  }
  return { ok: true, email: session.user.email ?? null };
}
