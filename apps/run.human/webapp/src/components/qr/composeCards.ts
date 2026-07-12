/**
 * W1 "Terminal" wallpaper (1080x1920) + S1 "Badge" share card (1080x1080).
 * Pure SVG-document builders — rasterization happens in downloadCardPng.
 * Layout constants approved via mockup session (spec 2026-07-12).
 */
const INK_BG = '#080a0e';
const CARD_BG = '#0a0c11';
const MINT = '#3df2c4';
const MAGENTA = '#c4157a';
const LIGHT = '#e8edf5';
const MUTED = '#8b93a3';
const MONO = 'ui-monospace,Menlo,monospace';

export const WALLPAPER = { w: 1080, h: 1920 };
export const SHARECARD = { w: 1080, h: 1080 };

export type CardCopy = {
  tagline: string;
  prompt: string;
  wordmark: string;
  site: string;
};

export interface CardArgs {
  qrSvg: string;
  name: string;
  bib: string | null;
  bunnyDataUri: string;
  copy: CardCopy;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Nested-svg embed: give the QR document explicit x/y/size. */
function nestQr(qrSvg: string, x: number, y: number, size: number): string {
  return qrSvg.replace(
    '<svg ',
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" `,
  );
}

/** Prompt accent rule (spec): segment after the LAST '/' renders magenta. */
function promptSpans(prompt: string, x: number, y: number, fontSize: number): string {
  const i = prompt.lastIndexOf('/');
  const head = i >= 0 ? prompt.slice(0, i + 1) : prompt;
  const tail = i >= 0 ? prompt.slice(i + 1) : '';
  return (
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="${MONO}" font-size="${fontSize}" letter-spacing="0.12em">` +
    `<tspan fill="${MINT}">${esc(head)}</tspan>` +
    (tail ? `<tspan fill="${MAGENTA}">${esc(tail)}</tspan>` : '') +
    `</text>`
  );
}

export function composeWallpaperSvg({ qrSvg, name, bib, bunnyDataUri, copy }: CardArgs): string {
  const { w, h } = WALLPAPER;
  const qrSize = 640;
  const qrX = (w - qrSize) / 2;
  const qrY = 700;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${INK_BG}"/>` +
    `<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<rect width="4" height="1" y="3" fill="rgba(61,242,196,0.025)"/></pattern></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#scan)"/>` +
    // top ~640px deliberately empty: lock-screen clock zone
    promptSpans(copy.prompt, w / 2, 640, 34) +
    nestQr(qrSvg, qrX, qrY, qrSize) +
    `<text x="${w / 2}" y="${qrY + qrSize + 92}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="52" letter-spacing="0.06em" fill="${LIGHT}">${esc(name)}</text>` +
    (bib
      ? `<text x="${w / 2}" y="${qrY + qrSize + 156}" text-anchor="middle" font-family="${MONO}" font-size="38" fill="${MAGENTA}">\u{1F3BD} ${esc(bib)}</text>`
      : '') +
    `<text x="${w / 2}" y="${qrY + qrSize + 226}" text-anchor="middle" font-family="${MONO}" font-size="26" letter-spacing="0.34em" fill="${MUTED}">${esc(copy.tagline)}</text>` +
    `<image href="${bunnyDataUri}" x="${(w - 700) / 2}" y="${h - 360}" width="700" opacity="0.10"/>` +
    `</svg>`
  );
}

export function composeShareCardSvg({ qrSvg, name, bib, bunnyDataUri, copy }: CardArgs): string {
  const { w, h } = SHARECARD;
  const qrSize = 480;
  const qrX = 80;
  const qrY = 300;
  const tx = 620; // identity block left edge
  const nameSize = name.length > 17 ? 32 : name.length > 14 ? 40 : 48;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" rx="48" fill="${CARD_BG}"/>` +
    `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="47" fill="none" stroke="rgba(61,242,196,0.35)" stroke-width="3"/>` +
    `<rect x="36" y="36" width="${w - 72}" height="${h - 72}" rx="36" fill="none" stroke="rgba(61,242,196,0.25)" stroke-width="2" stroke-dasharray="10 8"/>` +
    // lanyard punch hole
    `<rect x="${(w - 132) / 2}" y="64" width="132" height="28" rx="14" fill="#000" stroke="#262b35" stroke-width="2"/>` +
    nestQr(qrSvg, qrX, qrY, qrSize) +
    `<text x="${tx}" y="352" font-family="${MONO}" font-size="34" letter-spacing="0.3em" fill="${LIGHT}">${esc(copy.wordmark)}</text>` +
    `<text x="${tx}" y="396" font-family="${MONO}" font-size="28" fill="${MINT}">${esc(copy.site)}</text>` +
    `<text x="${tx}" y="490" font-family="${MONO}" font-weight="700" font-size="${nameSize}" letter-spacing="0.04em" fill="${LIGHT}">${esc(name)}</text>` +
    (bib
      ? `<text x="${tx}" y="548" font-family="${MONO}" font-size="34" fill="${MAGENTA}">\u{1F3BD} ${esc(bib)}</text>`
      : '') +
    `<text x="${tx}" y="640" font-family="${MONO}" font-size="24" letter-spacing="0.3em" fill="${MUTED}">${esc(copy.tagline)}</text>` +
    `<image href="${bunnyDataUri}" x="${tx}" y="676" width="150" opacity="0.5"/>` +
    `</svg>`
  );
}
