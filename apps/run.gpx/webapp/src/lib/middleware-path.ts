/**
 * basePath normalisation for middleware route guards.
 *
 * ── The bug this exists to prevent (2026-08-02) ─────────────────────────────
 * Whether `req.nextUrl.pathname` still carries the `/use1` basePath depends on
 * RUNTIME config, not on the compiled matcher. run.gpx sets `AUTH_URL`
 * (`https://gpx.defcon.run/use1/api/auth`) in ECS, and with it set the pathname
 * arrives as `/use1/studio/app`; with it unset it arrives pre-stripped as
 * `/studio/app`.
 *
 * The studio guard was a bare `pathname.startsWith("/studio")`, so in
 * production it matched NOTHING: the middleware ran, fell straight through to
 * `NextResponse.next()`, and `public/studio/app.html` was served to anonymous
 * visitors — an unauthenticated empty globe. No error, no log, no redirect.
 * `/use1/` still behaved correctly because it is guarded by a server component
 * (`app/page.tsx` → `auth()` + `redirect`), which does no path string matching.
 *
 * Both shapes must therefore be handled, and redirect targets must re-attach
 * the prefix ONLY when the incoming pathname carried it — otherwise Next
 * re-applies basePath itself and emits `/use1/use1/signin`.
 */

export interface BasePathView {
  /** Pathname with the basePath removed, always comparable to "/studio". */
  pathname: string;
  /** True when the incoming pathname carried the basePath. */
  hasBasePath: boolean;
  /** Build a redirect target, re-attaching the prefix only when needed. */
  target: (path: string) => string;
}

/**
 * @param rawPathname `req.nextUrl.pathname` exactly as received
 * @param basePath e.g. "/use1" in production, "" in dev (no basePath applied)
 */
export function viewWithoutBasePath(
  rawPathname: string,
  basePath: string,
): BasePathView {
  const hasBasePath =
    basePath !== "" &&
    (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`));
  const pathname = hasBasePath
    ? rawPathname.slice(basePath.length) || "/"
    : rawPathname;
  return {
    pathname,
    hasBasePath,
    target: (path: string) => (hasBasePath ? `${basePath}${path}` : path),
  };
}
