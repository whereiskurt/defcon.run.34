/**
 * Transition helper for the 2026-07 auth-cookie descoping.
 *
 * run.human's Auth.js cookies used to be written with `Domain=.defcon.run`,
 * which parked every app's session/csrf/state cookies on every *.defcon.run
 * request (a power user's Cookie header crossed nginx's 8k line limit). They
 * are now host-only — but a browser that still holds the legacy parent-domain
 * cookie will send BOTH, and the legacy one (older creation time) is ordered
 * first, shadowing the live host-only cookie indefinitely. The server cannot
 * see cookie attributes, so the only reliable tell is a duplicated name in
 * the raw Cookie header; when we see one, middleware deletes the legacy
 * parent-domain variant (deleting by name+domain+path can never touch the
 * host-only cookie).
 */

const AUTH_COOKIE_BASES = ["sess_run", "csrf_run", "callback_run", "state_run"];

/**
 * Names of run.human auth cookies (including `.N` chunk variants) that appear
 * more than once in the raw Cookie header — i.e. a legacy parent-domain copy
 * coexists with the live host-only copy and must be cleared.
 */
export function findDuplicateAuthCookies(
  cookieHeader: string | null | undefined
): string[] {
  if (!cookieHeader) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const isAuthCookie = AUTH_COOKIE_BASES.some(
      (base) => name === base || name.startsWith(`${base}.`)
    );
    if (isAuthCookie) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([name]) => name);
}
