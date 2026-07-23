import { TOKEN_RE } from '@/lib/short-token';

/**
 * Strict allowlist for camera-scanned QR text. Accepts ONLY the runner-QR
 * shapes this site mints (see buildQrPayload.ts / the q. resolver) and maps
 * them to a LOCAL award path, skipping the q.defcon.run redirect hop:
 *
 *   https://q.<domain>/r/<token16>                → { kind: "token" }
 *   https://run.<domain>[/<region>]/r?p=<token16> → { kind: "token" }
 *   https://run.<domain>[/<region>]/r?h=<hash64>  → { kind: "hash" } (legacy eqr)
 *
 * Everything else — including the bare `/r` rickroll, extra params/segments,
 * uppercase hex, other domains — returns null and the scanner keeps looking.
 */

const SITE_DOMAIN = process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run';
const HASH_RE = /^[0-9a-f]{64}$/;
const REGION_SEG_RE = /^[a-z0-9-]+$/;

export type RunnerQr = { kind: 'token' | 'hash'; value: string };

export function parseRunnerQr(
  text: string,
  domain: string = SITE_DOMAIN,
): RunnerQr | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  if (url.hostname === `q.${domain}`) {
    if ([...url.searchParams.keys()].length > 0) return null;
    const m = url.pathname.match(/^\/r\/([0-9a-f]{16})$/);
    return m ? { kind: 'token', value: m[1] } : null;
  }

  if (url.hostname === `run.${domain}`) {
    const segs = url.pathname.split('/').filter(Boolean);
    const isR =
      (segs.length === 1 && segs[0] === 'r') ||
      (segs.length === 2 && REGION_SEG_RE.test(segs[0]) && segs[1] === 'r');
    if (!isR) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1) return null;
    if (keys[0] === 'p') {
      const p = url.searchParams.get('p')!;
      return TOKEN_RE.test(p) ? { kind: 'token', value: p } : null;
    }
    if (keys[0] === 'h') {
      const h = url.searchParams.get('h')!;
      return HASH_RE.test(h) ? { kind: 'hash', value: h } : null;
    }
    return null;
  }

  return null;
}

/** Same-origin path the /r award page lives at (basePath = "" dev, "/use1" prod). */
export function awardPathFor(qr: RunnerQr, basePath: string): string {
  return qr.kind === 'token'
    ? `${basePath}/r?p=${qr.value}`
    : `${basePath}/r?h=${qr.value}`;
}
