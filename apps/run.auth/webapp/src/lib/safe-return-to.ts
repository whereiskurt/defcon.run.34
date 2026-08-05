/**
 * Validating the `?returnTo=` parameter on the Strava link page.
 *
 * The page previously called `signIn('strava', { callbackUrl: '/' })` with the
 * destination hardcoded, so anyone who started linking from another defcon.run
 * property finished OAuth on this app's homepage with no way back to what they
 * were doing. The gpx studio's "Connect Strava" door now passes where it wants
 * the runner returned.
 *
 * A caller-supplied redirect target is an open-redirect primitive, so this is an
 * allowlist, not a sanitiser: anything that isn't demonstrably a defcon.run URL
 * collapses to the old default of "/". Pure and exported so the rules are
 * unit-tested rather than trusted.
 */

/** Hosts we will hand a visitor back to after OAuth. */
function isAllowedHost(hostname: string, allowLocalhost: boolean): boolean {
  const h = hostname.toLowerCase();
  if (h === "defcon.run") return true;
  // Leading dot matters: "evildefcon.run" ends with "defcon.run" but is NOT a
  // subdomain of it.
  if (h.endsWith(".defcon.run")) return true;
  if (allowLocalhost && (h === "localhost" || h === "127.0.0.1")) return true;
  return false;
}

/**
 * The URL to send the visitor to after linking Strava, or "/" when the supplied
 * value is missing, malformed, or off-site.
 *
 * `base` is the current origin, used to resolve relative values — a bare path
 * like "/use1/studio/app?addrun" is same-origin and always fine.
 */
export function safeReturnTo(
  raw: string | null | undefined,
  base: string,
  opts: { allowLocalhost?: boolean } = {}
): string {
  if (!raw) return "/";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return "/";
  }
  // Blocks javascript:, data:, and friends — a protocol-relative "//evil.com"
  // is already normalised into a real host by the URL parser above, so it is
  // caught by the host check rather than here.
  if (url.protocol !== "https:" && url.protocol !== "http:") return "/";
  if (!isAllowedHost(url.hostname, opts.allowLocalhost ?? false)) return "/";
  return url.toString();
}
