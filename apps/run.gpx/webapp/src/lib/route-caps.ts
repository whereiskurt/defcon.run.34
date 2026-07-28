/**
 * Route abuse/resource caps (2026-07-28 routes-vs-runs spec, section 5).
 * Pure constants + predicates so the numbers are test-locked in one place.
 */

export const ROUTE_TOTAL_CAP = 50;
export const ROUTE_PUBLISH_CAP = 20;
export const ROUTE_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
export const COPY_FILE_SANITY_CAP = 500;

export function isRouteCapped(count: number, isAdmin: boolean): boolean {
  return !isAdmin && count >= ROUTE_TOTAL_CAP;
}

export function isPublishCapped(count: number, isAdmin: boolean): boolean {
  return !isAdmin && count >= ROUTE_PUBLISH_CAP;
}
