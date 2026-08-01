/**
 * The one place a /studio/share/{token} URL is built.
 *
 * Extracted from api/gpx/shares/route.ts so the unified visibility endpoint
 * (api/gpx/files/[id]/visibility) mints byte-identical URLs. A divergence here
 * would produce share links that 404 in production, which is exactly the kind
 * of bug two copies of this logic invites.
 *
 *   Local: http://localhost:3003/studio/share/{token}
 *   Prod:  https://gpx.defcon.run/{region}/studio/share/{token}
 */
export function buildShareUrl(shareId: string): string {
  const webappOrigin = process.env.WEBAPP_ORIGIN; // production: "gpx.defcon.run"
  const regionShort = process.env.REGION_SHORT; // production: "use1" | "cac1"
  const isProduction =
    webappOrigin?.includes("defcon.run") || process.env.NODE_ENV === "production";

  if (isProduction && webappOrigin && regionShort) {
    return `https://${webappOrigin}/${regionShort}/studio/share/${shareId}`;
  }
  return `http://localhost:${process.env.PORT || "3003"}/studio/share/${shareId}`;
}
