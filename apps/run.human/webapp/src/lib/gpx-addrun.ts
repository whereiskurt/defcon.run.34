/**
 * URL of the gpx.studio QuickStart hub ("Add Run").
 *
 * `/{region}/studio/app` is the ONLY terminal path on the gpx origin. Linking
 * to bare `gpx.defcon.run` hits an interstitial that runs
 * `location.replace('/' + region + '/')`, dropping both the query string and
 * the hash — `?addrun` disappears and nothing reports an error. `/use1` then
 * 307s query-stripped. Always link the full studio path.
 *
 * The `process.env.NEXT_PUBLIC_*` reads are deliberately written as literal
 * member expressions: Next.js inlines only that exact form at build time, so
 * reading them through a variable or parameter yields `undefined` in the
 * browser.
 */
export function gpxAddRunUrl(): string {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) return "http://localhost:3003/studio/app?addrun";

  const siteDomain = process.env.NEXT_PUBLIC_SITE_DOMAIN || "defcon.run";
  const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
  return `https://gpx.${siteDomain}/${region}/studio/app?addrun`;
}
