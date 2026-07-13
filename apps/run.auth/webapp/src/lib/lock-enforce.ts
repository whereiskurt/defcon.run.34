/**
 * Admin lock-out enforcement helper for run.auth's own Auth.js session.
 *
 * `lockedOut` is set by the admin console (identities/[userId]/lock). Downstream
 * RPs read it via /api/session/validate; run.auth itself must enforce it in two
 * places (config/auth.ts): the signIn callback (block re-login) and the jwt
 * callback (invalidate a warm session). This is the single predicate both use.
 */
export function isLockedOut(profile: { lockedOut?: boolean } | null | undefined): boolean {
  return profile?.lockedOut === true;
}
