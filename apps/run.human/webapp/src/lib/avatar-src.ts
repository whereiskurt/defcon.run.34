/**
 * Pick the avatar image to render for a session user.
 *
 * The OIDC `picture` claim is NOT trustworthy as a URL. Strava returns the
 * relative sentinel "avatar/athlete/medium.png" for athletes who never uploaded
 * a profile photo, and run.auth passed that through verbatim for a long time.
 * Rendered here it resolves against the current page — producing
 * https://run.defcon.run/use1/avatar/athlete/medium.png — which 404s.
 *
 * It defeats a plain `image ?? fallback` because it is a non-empty string, so
 * the check has to be on the SHAPE of the value, not merely its presence.
 *
 * run.auth now strips this at the source, but sessions minted before that fix
 * still carry the sentinel in an already-issued token, so this guard is what
 * heals the UI without forcing everyone to sign out and back in.
 */
export function resolveAvatarSrc(
  image: string | null | undefined,
  fallback: string
): string {
  if (typeof image !== "string") return fallback;
  const value = image.trim();
  if (!value || value === "undefined" || value === "null") return fallback;
  // Only an absolute http(s) URL can be rendered from any page path safely.
  return /^https?:\/\//i.test(value) ? value : fallback;
}
