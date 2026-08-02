/**
 * Client-side API base for the admin pages.
 *
 * THE BUG THIS FIXES. `next.config.ts` sets `basePath: "/use1"` in production,
 * but Next's basePath applies to <Link>, router navigation and asset URLs — it
 * does NOT rewrite a raw `fetch("/api/...")`. So a bare absolute fetch from an
 * admin page resolves against the origin, misses the region prefix entirely and
 * returns 404. The page itself renders fine (it is server-rendered under the
 * basePath), which makes the failure look like an auth problem rather than a
 * URL problem — `/admin/routes` shipped broken this way and nobody spotted it.
 *
 * Derived from the live pathname rather than an env var, so it cannot drift
 * from however the app is actually mounted:
 *   prod  "/use1/admin/routes"  → "/use1"
 *   dev   "/admin/routes"       → ""
 */
export function adminApiBase(pathname: string): string {
  const i = pathname.indexOf("/admin");
  return i > 0 ? pathname.slice(0, i) : "";
}

/** Browser-side convenience wrapper. Empty string during SSR. */
export function adminApiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${adminApiBase(window.location.pathname)}${path}`;
}
