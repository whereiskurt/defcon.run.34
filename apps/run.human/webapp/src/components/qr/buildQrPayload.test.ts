import { describe, it, expect } from 'vitest';
import { buildQrPayload } from './buildQrPayload';

// GUARD: must stay byte-identical to entities/run-user.ts eqr generation:
//   `https://q.${siteDomain}/r/${shortTokenFromHash(hash)}`
describe('buildQrPayload', () => {
  const HASH = 'c0ffee5417beefcafe1234567890abcdef1234567890abcdef1234567890abcd';

  it('matches the server-side eqr URL format byte-for-byte', () => {
    const siteDomain = 'defcon.run';
    const serverTemplate = `https://q.${siteDomain}/r/${HASH.slice(0, 16)}`;
    expect(buildQrPayload(HASH, 'defcon.run')).toBe(serverTemplate);
  });

  it('is short and region-free', () => {
    const url = buildQrPayload(HASH);
    expect(url).toBe('https://q.defcon.run/r/c0ffee5417beefca');
    expect(url).not.toContain('use1');
    expect(url.length).toBeLessThan(40);
  });

  it('rejects malformed hashes loudly', () => {
    expect(() => buildQrPayload('abc')).toThrow();
  });
});
