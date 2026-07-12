import { describe, it, expect } from 'vitest';
import { buildQrPayload } from './buildQrPayload';

// GUARD: must stay byte-identical to entities/run-user.ts eqr generation:
//   `https://run.${siteDomain}/${REGION_SHORT}/r?h=${hash}`
describe('buildQrPayload', () => {
  const HASH = 'c0ffee5417beefcafe1234567890abcdef1234567890abcdef1234567890abcd';

  it('matches the server-side eqr URL format byte-for-byte', () => {
    const siteDomain = 'defcon.run';
    const REGION_SHORT = 'use1';
    const serverTemplate = `https://run.${siteDomain}/${REGION_SHORT}/r?h=${HASH}`;
    expect(buildQrPayload(HASH, 'use1', 'defcon.run')).toBe(serverTemplate);
  });

  it('defaults region/domain from env fallbacks', () => {
    expect(buildQrPayload('abc')).toBe('https://run.defcon.run/use1/r?h=abc');
  });
});
