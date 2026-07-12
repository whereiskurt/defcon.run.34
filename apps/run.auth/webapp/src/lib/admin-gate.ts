/**
 * run.auth admin gate. Group-claim based: admin access is granted ONLY via
 * `admin` or `runadmin` in the session's `services` list (the AuthProfile
 * "groups" model, surfaced on the Auth.js session as session.user.services).
 * No email allowlist.
 *
 * Non-disclosure: callers map BOTH failure reasons to a 404 (never 401/403).
 * Framework-neutral (imports no Next.js) so page and route handlers share it.
 *
 * Live revalidation is IN-PROCESS here (run.auth IS the auth server): we read
 * AuthProfile directly rather than over HTTP. Fail-closed on any error.
 */
import { getAuthProfile } from "@/entities/auth-profile";

export type SessionLike =
  | { user?: { services?: string[] | null; email?: string | null; id?: string | null } | null }
  | null
  | undefined;

export const ADMIN_GROUPS = ["admin", "runadmin"] as const;

export function isAdmin(session: SessionLike): boolean {
  const services = session?.user?.services;
  return (
    Array.isArray(services) &&
    services.some((s) => (ADMIN_GROUPS as readonly string[]).includes(s))
  );
}

export type RequireAdminResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: "no_session" | "not_admin" };

export function requireAdmin(session: SessionLike): RequireAdminResult {
  if (!session?.user) return { ok: false, reason: "no_session" };
  if (!isAdmin(session)) return { ok: false, reason: "not_admin" };
  return { ok: true, email: session.user.email ?? null };
}

/**
 * Live re-check against the AuthProfile groups model to defeat the ~5-min JWT
 * staleness window. Grants on admin||runadmin AND not locked out. Fail-closed.
 */
export async function revalidateAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const profile = await getAuthProfile(userId);
    if (!profile || profile.lockedOut) return false;
    const services = profile.services ?? [];
    return services.some((s) => (ADMIN_GROUPS as readonly string[]).includes(s));
  } catch {
    return false;
  }
}
