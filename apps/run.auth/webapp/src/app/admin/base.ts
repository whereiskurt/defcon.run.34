// Shared region base-path for admin CLIENT fetches.
//
// In production the app is mounted at Next `basePath: /{region}` (e.g. /use1).
// Native browser fetch() does NOT honor basePath (only <Link>/router/assets do),
// so EVERY admin API call must be built through `adminApi()` / prefixed with
// `BASE` — a bare fetch("/api/admin/...") hits the domain root and 404s in prod
// (the routes actually live at /{region}/api/admin/...). This module is the
// single source of truth so the two admin client files can't drift (which is
// exactly how the lock/jail/delete actions silently 404'd before).
export const BASE = process.env.NODE_ENV === "production"
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
  : "";

/** Build a region-prefixed admin API URL. Use for ALL admin client fetches. */
export const adminApi = (path: string): string => `${BASE}${path}`;
