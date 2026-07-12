/**
 * Rebuilds the EXACT URL the stored `eqr` PNG encodes (entities/run-user.ts).
 * If this ever drifts from that template, scans route wrong — see the guard test.
 */
const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';
const SITE_DOMAIN = process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run';

export function buildQrPayload(
  hash: string,
  region: string = REGION_SHORT,
  domain: string = SITE_DOMAIN,
): string {
  return `https://run.${domain}/${region}/r?h=${hash}`;
}
