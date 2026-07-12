import { describe, it, expect } from 'vitest';
import {
  composeWallpaperSvg,
  composeShareCardSvg,
  WALLPAPER,
  SHARECARD,
} from './composeCards';

const args = {
  qrSvg: '<svg viewBox="0 0 59 59"><rect width="59" height="59" fill="#fff"/></svg>',
  name: 'SAMPLE RUNNER',
  bib: 'BIB-C0DE',
  bunnyDataUri: 'data:image/png;base64,AAAA',
  copy: {
    tagline: 'SCAN TO CONNECT',
    prompt: '$ defcon.run/connect_',
    wordmark: 'DEF CON 34',
    site: 'defcon.run',
  },
};

describe('composeWallpaperSvg', () => {
  const svg = composeWallpaperSvg(args);
  it('is a 1080x1920 svg with name, bib, tagline, bunny and nested QR', () => {
    expect(svg).toContain(`viewBox="0 0 ${WALLPAPER.w} ${WALLPAPER.h}"`);
    expect(svg).toContain('SAMPLE RUNNER');
    expect(svg).toContain('BIB-C0DE');
    expect(svg).toContain('SCAN TO CONNECT');
    expect(svg).toContain('data:image/png;base64,AAAA');
    expect(svg).toContain('viewBox="0 0 59 59"'); // nested QR svg
  });
  it('splits the prompt at the last slash for the magenta accent', () => {
    expect(svg).toContain('>$ defcon.run/<');
    expect(svg).toContain('>connect_<');
  });
  it('keeps the top clock zone clear (no text above y=520)', () => {
    for (const m of svg.matchAll(/<text[^>]* y="(\d+(?:\.\d+)?)"/g)) {
      expect(Number(m[1])).toBeGreaterThan(520);
    }
  });
  it('omits the bib line when bib is null', () => {
    expect(composeWallpaperSvg({ ...args, bib: null })).not.toContain('BIB-C0DE');
  });
});

describe('composeShareCardSvg', () => {
  const svg = composeShareCardSvg(args);
  it('is a 1080x1080 svg with identity block and nested QR', () => {
    expect(svg).toContain(`viewBox="0 0 ${SHARECARD.w} ${SHARECARD.h}"`);
    expect(svg).toContain('SAMPLE RUNNER');
    expect(svg).toContain('DEF CON 34');
    expect(svg).toContain('defcon.run');
    expect(svg).toContain('SCAN TO CONNECT');
    expect(svg).toContain('viewBox="0 0 59 59"');
  });
  it('omits the bib line when bib is null', () => {
    expect(composeShareCardSvg({ ...args, bib: null })).not.toContain('BIB-C0DE');
  });
});
