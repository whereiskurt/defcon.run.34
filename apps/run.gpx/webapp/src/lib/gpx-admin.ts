/**
 * Moderation access for run.gpx.
 *
 * Mirrors run.auth's `ADMIN_GROUPS` (`lib/admin-gate.ts`), which run.bib already
 * honours: both `admin` and `runadmin` are administrative groups. run.gpx had
 * only ever checked `admin`, so a `runadmin` got a 404 on every moderation
 * surface here while being an admin everywhere else in the estate.
 *
 * SCOPE — this is deliberately NOT used for the `isAdmin` flags scattered
 * through the quota and cap logic (con-day tier, Strava sync tier, route/publish
 * caps, GLOBAL-folder create/publish). Those grant resource exemptions rather
 * than moderation authority, and widening them is a separate decision with cost
 * consequences. They stay `admin`-only until someone decides otherwise.
 */
export const GPX_ADMIN_GROUPS = ["admin", "runadmin"] as const;

export function isGpxAdmin(services: string[] | undefined): boolean {
  const list = services ?? [];
  return GPX_ADMIN_GROUPS.some((g) => list.includes(g));
}
