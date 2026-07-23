import { shortTokenFromHash } from '@/lib/short-token';

/**
 * Rebuilds the EXACT URL the stored `eqr` PNG encodes (entities/run-user.ts).
 * If this ever drifts from that template, scans route wrong — see the guard test.
 *
 * Short form (DC34): `https://q.<domain>/r/<token16>` — region-agnostic; the
 * q.defcon.run resolver's `r` code owns the region splice and redirects to
 * `run.<domain>/<region>/r?p=<token16>`. Legacy `?h=<sha256>` links (old
 * stored eqr PNGs) are still honored by the /r route itself.
 */
const SITE_DOMAIN = process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run';

export function buildQrPayload(
  hash: string,
  domain: string = SITE_DOMAIN,
): string {
  return `https://q.${domain}/r/${shortTokenFromHash(hash)}`;
}
