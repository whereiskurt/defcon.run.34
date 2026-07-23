import { describe, it, expect } from 'vitest';
import { parseRunnerQr, awardPathFor } from './parseRunnerQr';

const TOKEN = 'c0ffee5417beefca';
const HASH = 'c0ffee5417beefcafe1234567890abcdef1234567890abcdef1234567890abcd';

describe('parseRunnerQr', () => {
  // ---- accepted shapes -----------------------------------------------------
  it('accepts the short q. form (the DC34 QR payload)', () => {
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN}`)).toEqual({
      kind: 'token', value: TOKEN,
    });
  });

  it('accepts the resolved run. form with any region segment', () => {
    for (const region of ['use1', 'cac1', 'euw1']) {
      expect(parseRunnerQr(`https://run.defcon.run/${region}/r?p=${TOKEN}`)).toEqual({
        kind: 'token', value: TOKEN,
      });
    }
  });

  it('accepts the region-less run. form (dev)', () => {
    expect(parseRunnerQr(`https://run.defcon.run/r?p=${TOKEN}`)).toEqual({
      kind: 'token', value: TOKEN,
    });
  });

  it('accepts the legacy long-hash run. form (old stored eqr PNGs)', () => {
    expect(parseRunnerQr(`https://run.defcon.run/use1/r?h=${HASH}`)).toEqual({
      kind: 'hash', value: HASH,
    });
  });

  it('tolerates surrounding whitespace in the decoded text', () => {
    expect(parseRunnerQr(`  https://q.defcon.run/r/${TOKEN}\n`)).toEqual({
      kind: 'token', value: TOKEN,
    });
  });

  it('honors the domain argument', () => {
    expect(parseRunnerQr(`https://q.example.test/r/${TOKEN}`, 'example.test')).toEqual({
      kind: 'token', value: TOKEN,
    });
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN}`, 'example.test')).toBeNull();
  });

  // ---- rejected shapes -----------------------------------------------------
  it('rejects the bare /r rickroll (no token)', () => {
    expect(parseRunnerQr('https://q.defcon.run/r')).toBeNull();
    expect(parseRunnerQr('https://q.defcon.run/r/')).toBeNull();
  });

  it('rejects wrong domains and subdomains', () => {
    expect(parseRunnerQr(`https://q.evil.run/r/${TOKEN}`)).toBeNull();
    expect(parseRunnerQr(`https://qq.defcon.run/r/${TOKEN}`)).toBeNull();
    expect(parseRunnerQr(`https://q.defcon.run.evil.io/r/${TOKEN}`)).toBeNull();
    expect(parseRunnerQr(`https://defcon.run/r/${TOKEN}`)).toBeNull();
  });

  it('rejects non-https schemes', () => {
    expect(parseRunnerQr(`http://q.defcon.run/r/${TOKEN}`)).toBeNull();
    expect(parseRunnerQr(`javascript:alert(1)`)).toBeNull();
  });

  it('rejects wrong token/hash lengths', () => {
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN.slice(0, 15)}`)).toBeNull();
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN}0`)).toBeNull();
    expect(parseRunnerQr(`https://run.defcon.run/use1/r?h=${HASH.slice(0, 63)}`)).toBeNull();
    expect(parseRunnerQr(`https://run.defcon.run/use1/r?p=${HASH}`)).toBeNull();
  });

  it('rejects uppercase hex (tokens are lowercase-only)', () => {
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN.toUpperCase()}`)).toBeNull();
    expect(parseRunnerQr(`https://run.defcon.run/use1/r?h=${HASH.toUpperCase()}`)).toBeNull();
  });

  it('rejects extra query params and extra path segments', () => {
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN}?x=1`)).toBeNull();
    expect(parseRunnerQr(`https://q.defcon.run/r/${TOKEN}/extra`)).toBeNull();
    expect(parseRunnerQr(`https://run.defcon.run/use1/r?p=${TOKEN}&x=1`)).toBeNull();
    expect(parseRunnerQr(`https://run.defcon.run/use1/deep/r?p=${TOKEN}`)).toBeNull();
  });

  it('rejects non-URL garbage', () => {
    expect(parseRunnerQr('')).toBeNull();
    expect(parseRunnerQr('hello world')).toBeNull();
    expect(parseRunnerQr(TOKEN)).toBeNull();
    expect(parseRunnerQr('WIFI:S:defcon;T:WPA;P:hunter2;;')).toBeNull();
  });
});

describe('awardPathFor', () => {
  it('builds a same-origin token award path under the basePath', () => {
    expect(awardPathFor({ kind: 'token', value: TOKEN }, '/use1'))
      .toBe(`/use1/r?p=${TOKEN}`);
    expect(awardPathFor({ kind: 'token', value: TOKEN }, ''))
      .toBe(`/r?p=${TOKEN}`);
  });

  it('builds a legacy hash award path', () => {
    expect(awardPathFor({ kind: 'hash', value: HASH }, '/use1'))
      .toBe(`/use1/r?h=${HASH}`);
  });
});
