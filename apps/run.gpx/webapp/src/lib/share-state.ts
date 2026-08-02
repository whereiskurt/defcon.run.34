/**
 * Share-state vocabulary for the unified routes design (2026-08-01 spec).
 *
 * One route has exactly one of three states. The state is DERIVED from storage
 * rather than stored as its own column, so there is nothing to migrate and no
 * way for a flag to drift out of sync with the rows it describes:
 *   private → no published Route, no live share token
 *   link    → a GpxShare token exists
 *   public  → publishedRouteId points at a published Route
 *
 * Pure functions only — no AWS, no session. The route handler owns the I/O.
 */

export type ShareState = "private" | "link" | "public";

const STATES: readonly string[] = ["private", "link", "public"];

export function isShareState(value: unknown): value is ShareState {
  return typeof value === "string" && STATES.includes(value);
}

/**
 * Public outranks link: a route can carry a stale token from before it was
 * published, and the map listing is the stronger, more visible claim.
 */
export function deriveShareState(input: {
  publishedRouteId?: string;
  hasActiveLink: boolean;
}): ShareState {
  if (input.publishedRouteId) return "public";
  if (input.hasActiveLink) return "link";
  return "private";
}

/**
 * Compliance gate (Strava API terms). A raw import is publicShareEligible:false
 * and cannot be published as-is; the caller must mint a converted copy first.
 * `undefined` means a legacy row predating the flag, which defaults to eligible
 * exactly like the entity's own default.
 *
 * Order matters: an inactive file is reported as inactive even when it is also
 * ineligible, because "finish uploading" is the actionable message.
 */
export function canGoPublic(file: {
  status: string;
  publicShareEligible?: boolean;
  source?: string;
}): { ok: true } | { ok: false; reason: "inactive" | "needs-conversion" } {
  if (file.status !== "active") return { ok: false, reason: "inactive" };
  if (file.publicShareEligible === false) {
    return { ok: false, reason: "needs-conversion" };
  }
  return { ok: true };
}
