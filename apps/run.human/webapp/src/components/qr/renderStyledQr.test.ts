import { describe, it, expect } from 'vitest';
import { renderStyledQr, styledQrSvg } from './renderStyledQr';

const QUIET = 3;

/** Extract all square-module x/y coords from the single module <path>. */
function moduleCoords(svg: string): Array<[number, number]> {
  const m = svg.match(/<path d="((?:M\d+ \d+h1v1h-1z)*)" fill="#111118"\/>/);
  if (!m) return [];
  return [...m[1].matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((t) => [
    Number(t[1]),
    Number(t[2]),
  ]);
}

describe('styledQrSvg invariants (all-dark 53x53 fixture)', () => {
  const SIZE = 53;
  const svg = styledQrSvg(SIZE, () => true);
  const coords = moduleCoords(svg);

  it('draws three 34 pupils', () => {
    expect(svg.match(/>34<\/text>/g)?.length).toBe(3);
  });

  it('never draws modules inside the three finder zones', () => {
    const inFinder = (r: number, c: number) =>
      (r < 8 && c < 8) || (r < 8 && c >= SIZE - 8) || (r >= SIZE - 8 && c < 8);
    for (const [x, y] of coords) {
      expect(inFinder(y - QUIET, x - QUIET)).toBe(false);
    }
  });

  it('never draws modules inside the center knockout, and knockout holds the jack', () => {
    let k = Math.floor(SIZE * 0.24);
    if (k % 2 !== SIZE % 2) k += 1;
    const start = Math.floor((SIZE - k) / 2);
    for (const [x, y] of coords) {
      const r = y - QUIET;
      const c = x - QUIET;
      const inKnockout =
        r >= start && r < start + k && c >= start && c < start + k;
      expect(inKnockout).toBe(false);
    }
    expect(svg).toContain('fill="#c4157a" transform="translate(');
  });

  it('preserves timing tracks outside finder/knockout (row 6 present)', () => {
    // all-dark fixture: expect some (x, y=6+QUIET) modules between the finders
    const timingRow = coords.filter(([, y]) => y === 6 + QUIET);
    expect(timingRow.length).toBeGreaterThan(0);
  });
});

describe('renderStyledQr', () => {
  it('produces an svg document for a real payload', () => {
    const svg = renderStyledQr(
      'https://run.defcon.run/use1/r?h=c0ffee5417beefcafe1234567890abcdef1234567890abcdef1234567890abcd',
    );
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/>34<\/text>/g)?.length).toBe(3);
  });
});
