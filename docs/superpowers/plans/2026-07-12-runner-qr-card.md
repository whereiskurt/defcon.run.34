# Runner QR Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Styled DC34 runner QR (square modules, magenta "34" eyes, DC jack center) replacing the plain QR on whoami + header dropdown, plus a "Save QR card" modal that downloads a 1080×1920 Terminal wallpaper or 1080×1080 Badge share card rendered client-side.

**Architecture:** All in `apps/run.human/webapp`, zero backend changes. Pure modules (`buildQrPayload`, `renderStyledQr`, card composers) produce SVG strings from `userData.hash`; a thin client component displays the SVG inline, and a download util rasterizes composed cards via canvas→PNG. Card copy resolves through the existing `useCopy()`/`t()` hook with hardcoded defaults (CMS override optional, seeded later).

**Tech Stack:** Next.js 16 / React 19, HeroUI, `qrcode` (already a dependency), vitest 4, pngjs (transitive; one-time asset script).

**Spec:** `docs/superpowers/specs/2026-07-12-runner-qr-card-design.md`

## Global Constraints

- Branch: `feat/runner-qr-card` (already created from origin/main in this worktree). Never commit to main; PR at the end; do NOT merge without explicit user approval.
- Colors (exact): ink `#111118`, magenta `#c4157a`, mint `#3df2c4`, wallpaper bg `#080a0e`, share-card bg `#0a0c11`, light text `#e8edf5`, muted text `#8b93a3`.
- QR: error correction `H`, quiet zone 3 modules, square modules only, three magenta rounded eyes with white `34` pupils, DC jack center knockout ≈24% span. No other stamps (EC budget).
- Payload format is sacred: `https://run.${domain}/${region}/r?h=${hash}` — must match `src/entities/run-user.ts:197` byte-for-byte.
- Tagline default: `SCAN TO CONNECT`. Prompt default: `$ defcon.run/connect_` (segment after last `/` drawn magenta).
- Copy keys use default-floor: `t(key)` echoes the key when unset → helper falls back to hardcoded default. Do NOT edit `copy-snapshot.json` (CMS-synced; seeding is a separate deploy-time step).
- Run vitest with Node ≥22.12: `nvm use 23.6.0` first (default v22.1.0 fails to start vitest — looks like a test failure but is environmental).
- All commands below run from `apps/run.human/webapp` unless stated otherwise. Repo root is the worktree at `.claude/worktrees/walletqr`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 0: Workspace setup

**Files:** none (environment only)

- [ ] **Step 0.1:** `cd apps/run.human/webapp && npm install` (worktree has no node_modules). Expected: completes without errors; `node_modules/qrcode` and `node_modules/pngjs` exist.
- [ ] **Step 0.2:** `nvm use 23.6.0 && npx vitest run src/components/profile/SocialQRRow.test.ts` to prove the harness works. Expected: existing tests PASS.

---

### Task 1: Transparent bunny asset

`public/header/bunny-head.png` is a white wireframe on OPAQUE black. Downloads rasterize SVG in an `<img>`, where CSS blend tricks don't apply — we need a real alpha PNG.

**Files:**
- Create: `apps/run.human/webapp/scripts/make-bunny-alpha.mjs`
- Create (generated): `apps/run.human/webapp/public/header/bunny-head-alpha.png`

**Interfaces:**
- Produces: `/header/bunny-head-alpha.png` — white wireframe, alpha = source luminance. Fetched at runtime by Task 6.

- [ ] **Step 1.1: Write the script**

```js
// scripts/make-bunny-alpha.mjs — one-time: luminance -> alpha, pixels forced white.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const src = PNG.sync.read(fs.readFileSync('public/header/bunny-head.png'));
const out = new PNG({ width: src.width, height: src.height });
for (let i = 0; i < src.data.length; i += 4) {
  const lum = Math.round(
    0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]
  );
  out.data[i] = 255;
  out.data[i + 1] = 255;
  out.data[i + 2] = 255;
  out.data[i + 3] = lum;
}
fs.writeFileSync('public/header/bunny-head-alpha.png', PNG.sync.write(out));
const opaque = [...out.data].filter((_, i) => i % 4 === 3 && out.data[i] > 200).length;
console.log(`wrote bunny-head-alpha.png ${out.width}x${out.height}, bright px: ${opaque}`);
```

- [ ] **Step 1.2: Run it**

Run: `node scripts/make-bunny-alpha.mjs`
Expected: `wrote bunny-head-alpha.png <W>x<H>, bright px: <nonzero>` and the file exists.

- [ ] **Step 1.3: Commit**

```bash
git add scripts/make-bunny-alpha.mjs public/header/bunny-head-alpha.png
git commit -m "feat(human): transparent bunny-head asset for QR cards"
```

---

### Task 2: buildQrPayload (pure) — TDD

**Files:**
- Create: `apps/run.human/webapp/src/components/qr/buildQrPayload.ts`
- Test: `apps/run.human/webapp/src/components/qr/buildQrPayload.test.ts`

**Interfaces:**
- Produces: `buildQrPayload(hash: string, region?: string, domain?: string): string` — defaults from `NEXT_PUBLIC_REGION_SHORT`/`NEXT_PUBLIC_SITE_DOMAIN` envs (fallbacks `use1`/`defcon.run`).

- [ ] **Step 2.1: Failing test**

```ts
// src/components/qr/buildQrPayload.test.ts
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
```

- [ ] **Step 2.2:** Run: `npx vitest run src/components/qr/buildQrPayload.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 2.3: Implement**

```ts
// src/components/qr/buildQrPayload.ts
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
```

- [ ] **Step 2.4:** Run: `npx vitest run src/components/qr/buildQrPayload.test.ts` — Expected: PASS (2 tests).
- [ ] **Step 2.5: Commit**

```bash
git add src/components/qr/buildQrPayload.ts src/components/qr/buildQrPayload.test.ts
git commit -m "feat(human): buildQrPayload mirrors server eqr URL format"
```

---

### Task 3: renderStyledQr (pure) — TDD

The core renderer: payload → SVG string in the approved B2 style. Split into a matrix-driven internal (`styledQrSvg`) for testability and a thin `renderStyledQr(payload)` wrapper.

**Files:**
- Create: `apps/run.human/webapp/src/components/qr/renderStyledQr.ts`
- Test: `apps/run.human/webapp/src/components/qr/renderStyledQr.test.ts`

**Interfaces:**
- Consumes: `buildQrPayload` (not directly — callers pass payload in).
- Produces:
  - `renderStyledQr(payload: string): string` — complete `<svg>` document string, white rounded background, viewBox `0 0 (size+6) (size+6)`.
  - `styledQrSvg(size: number, isDark: (r: number, c: number) => boolean): string` — test seam.
  - `QR_INK = '#111118'`, `QR_MAGENTA = '#c4157a'` exported constants.

- [ ] **Step 3.1: Get the DC jack path constant.** Run:

```bash
node -e "const s=require('fs').readFileSync('public/header/dcjack.svg','utf8');console.log(s.match(/ d=\"([^\"]+)\"/)[1])"
```

Copy the full output — it becomes the `DCJACK_PATH` string constant in Step 3.3 (single long string, no edits).

- [ ] **Step 3.2: Failing tests**

```ts
// src/components/qr/renderStyledQr.test.ts
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

  it('draws three white-34 pupils', () => {
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
```

- [ ] **Step 3.3:** Run: `npx vitest run src/components/qr/renderStyledQr.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3.4: Implement**

```ts
// src/components/qr/renderStyledQr.ts
/**
 * Styled DC34 runner QR ("B2"): square ink modules, rounded magenta finder
 * eyes with a white 34 in each pupil, magenta DC jack in a center knockout.
 * EC level H (~30% damage budget; knockout spends ~6%, pupils spend finder
 * pixels which have NO error correction — accepted trade-off, see spec).
 * Fallback if field scanning disappoints: pupil fill QR_INK + magenta text.
 */
import * as qr from 'qrcode';

export const QR_INK = '#111118';
export const QR_MAGENTA = '#c4157a';
const WHITE = '#ffffff';
const QUIET = 3;

const DCJACK_PATH = '<PASTE the d attribute captured in Step 3.1 verbatim>';

function eye(x: number, y: number): string {
  return (
    `<rect x="${x}" y="${y}" width="7" height="7" rx="2.1" fill="${QR_MAGENTA}"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.5" fill="${WHITE}"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1" fill="${QR_MAGENTA}"/>` +
    `<text x="${x + 3.5}" y="${y + 4.12}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="1.65" fill="${WHITE}">34</text>`
  );
}

export function styledQrSvg(
  size: number,
  isDark: (r: number, c: number) => boolean,
): string {
  const total = size + 2 * QUIET;
  let kSpan = Math.floor(size * 0.24);
  if (kSpan % 2 !== size % 2) kSpan += 1;
  const kStart = Math.floor((size - kSpan) / 2);

  const inFinder = (r: number, c: number) =>
    (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
  const inKnockout = (r: number, c: number) =>
    r >= kStart && r < kStart + kSpan && c >= kStart && c < kStart + kSpan;

  let modules = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isDark(r, c) || inFinder(r, c) || inKnockout(r, c)) continue;
      modules += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
  }

  const jackPad = 1.1;
  const jackScale = (kSpan - 2 * jackPad) / 200; // dcjack viewBox is 200x200

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision">` +
    `<rect width="${total}" height="${total}" rx="3" fill="${WHITE}"/>` +
    `<path d="${modules}" fill="${QR_INK}"/>` +
    eye(QUIET, QUIET) +
    eye(QUIET + size - 7, QUIET) +
    eye(QUIET, QUIET + size - 7) +
    `<path d="${DCJACK_PATH}" fill="${QR_MAGENTA}" transform="translate(${kStart + QUIET + jackPad} ${kStart + QUIET + jackPad}) scale(${jackScale})"/>` +
    `</svg>`
  );
}

export function renderStyledQr(payload: string): string {
  const code = qr.create(payload, { errorCorrectionLevel: 'H' });
  const { size, data } = code.modules as unknown as {
    size: number;
    data: Uint8Array;
  };
  return styledQrSvg(size, (r, c) => !!data[r * size + c]);
}
```

- [ ] **Step 3.5:** Run: `npx vitest run src/components/qr/renderStyledQr.test.ts` — Expected: PASS (5 tests).
- [ ] **Step 3.6: Phone-scan smoke check.** Write the SVG to a scratch file and open it:

```bash
node -e "
const {renderStyledQr}=require('./src/components/qr/renderStyledQr.ts');
" 2>/dev/null || npx tsx -e "
import {renderStyledQr} from './src/components/qr/renderStyledQr';
import fs from 'node:fs';
fs.writeFileSync('/tmp/styled-qr-check.svg', renderStyledQr('https://run.defcon.run/use1/r?h=c0ffee5417beefcafe1234567890abcdef1234567890abcdef1234567890abcd'));
console.log('wrote /tmp/styled-qr-check.svg');
"
open /tmp/styled-qr-check.svg
```

Expected: renders in browser; scanning with a phone opens the dummy URL. (If `tsx` unavailable, `npx vitest run` already proves structure; do the visual scan at Task 8 instead.)

- [ ] **Step 3.7: Commit**

```bash
git add src/components/qr/renderStyledQr.ts src/components/qr/renderStyledQr.test.ts
git commit -m "feat(human): styled DC34 runner QR renderer (B2: magenta 34-eyes + dcjack center)"
```

---

### Task 4: StyledRunnerQr component + site swap (whoami & dropdown)

**Files:**
- Create: `apps/run.human/webapp/src/components/qr/StyledRunnerQr.tsx`
- Modify: `apps/run.human/webapp/src/app/(protected)/whoami/page.tsx` (~line 39 UserData type; ~lines 357–370 QR panel)
- Modify: `apps/run.human/webapp/src/components/header/dropdown-user.tsx` (~lines 320, 340–343)

**Interfaces:**
- Consumes: `buildQrPayload(hash)`, `renderStyledQr(payload)` from Tasks 2–3.
- Produces: `<StyledRunnerQr hash={string|undefined} eqrFallback={string|undefined} className={string} alt={string} />` — renders styled SVG as an `<img src="data:image/svg+xml,...">`; falls back to `eqrFallback` PNG when `hash` is missing; renders nothing when both missing.

- [ ] **Step 4.1: Component**

```tsx
// src/components/qr/StyledRunnerQr.tsx
'use client';

import { useMemo } from 'react';
import { buildQrPayload } from './buildQrPayload';
import { renderStyledQr } from './renderStyledQr';

interface Props {
  hash?: string;
  eqrFallback?: string;
  className?: string;
  alt?: string;
}

/** Styled runner QR; falls back to the stored eqr PNG when hash is absent. */
export default function StyledRunnerQr({ hash, eqrFallback, className, alt }: Props) {
  const src = useMemo(() => {
    if (!hash) return eqrFallback ?? '';
    try {
      const svg = renderStyledQr(buildQrPayload(hash));
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      return eqrFallback ?? '';
    }
  }, [hash, eqrFallback]);

  if (!src) return null;
  return <img src={src} alt={alt ?? 'Your runner QR code'} className={className} />;
}
```

- [ ] **Step 4.2: whoami swap.** In `src/app/(protected)/whoami/page.tsx`:
  - Add `hash?: string;` to the `UserData` interface (next to `eqr?: string;` ~line 39).
  - Add import: `import StyledRunnerQr from '@/components/qr/StyledRunnerQr';`
  - Change the panel gate from `{userData?.eqr && (` to `{(userData?.hash || userData?.eqr) && (`.
  - Replace the `<img src={userData.eqr} alt="Your QR Code" className="max-w-[220px]" />` with:

```tsx
<StyledRunnerQr
  hash={userData.hash}
  eqrFallback={userData.eqr}
  alt="Your QR Code"
  className="max-w-[220px]"
/>
```

- [ ] **Step 4.3: dropdown swap.** In `src/components/header/dropdown-user.tsx`:
  - Add the same import.
  - Change `const hasQR = userDetail?.eqr;` to `const hasQR = userDetail?.hash || userDetail?.eqr;` (add `hash?: string` to its user-detail type if one exists in the file).
  - Replace `<img src={userDetail.eqr} className="w-full scale-110 -m-[0px]" />` with:

```tsx
<StyledRunnerQr hash={userDetail.hash} eqrFallback={userDetail.eqr} className="w-full scale-110 -m-[0px]" />
```

- [ ] **Step 4.4: Verify**

Run: `npx vitest run src/components/qr && npm run lint && npm run build`
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 4.5: Visual check.** `PORT=3001 npm run dev`, sign in locally, open `/whoami` → "Your Social QR": styled QR with magenta 34-eyes shows; header avatar dropdown QR also styled. Phone-scan one of them → resolves to your `/r?h=` URL.

- [ ] **Step 4.6: Commit**

```bash
git add src/components/qr/StyledRunnerQr.tsx "src/app/(protected)/whoami/page.tsx" src/components/header/dropdown-user.tsx
git commit -m "feat(human): styled runner QR on whoami + header dropdown (eqr fallback kept)"
```

---

### Task 5: Card composers (pure) — TDD

Two SVG documents: W1 Terminal wallpaper (1080×1920) and S1 Badge share card (1080×1080). Pure string builders — bunny image and QR arrive as parameters.

**Files:**
- Create: `apps/run.human/webapp/src/components/qr/composeCards.ts`
- Test: `apps/run.human/webapp/src/components/qr/composeCards.test.ts`

**Interfaces:**
- Consumes: QR SVG string from `renderStyledQr` (embedded as nested `<svg>` — pass through `stripSvgWrapper` below).
- Produces:
  - `type CardCopy = { tagline: string; prompt: string; wordmark: string; site: string }`
  - `composeWallpaperSvg(args: { qrSvg: string; name: string; bib: string | null; bunnyDataUri: string; copy: CardCopy }): string` — 1080×1920 SVG document.
  - `composeShareCardSvg(args: same): string` — 1080×1080 SVG document.
  - `WALLPAPER = { w: 1080, h: 1920 }`, `SHARECARD = { w: 1080, h: 1080 }` exported constants.

- [ ] **Step 5.1: Failing tests**

```ts
// src/components/qr/composeCards.test.ts
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
```

- [ ] **Step 5.2:** Run: `npx vitest run src/components/qr/composeCards.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 5.3: Implement**

```ts
// src/components/qr/composeCards.ts
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
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
  const nameSize = name.length > 14 ? 40 : 48;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
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
```

- [ ] **Step 5.4:** Run: `npx vitest run src/components/qr/composeCards.test.ts` — Expected: PASS (6 tests).
- [ ] **Step 5.5: Commit**

```bash
git add src/components/qr/composeCards.ts src/components/qr/composeCards.test.ts
git commit -m "feat(human): W1 wallpaper + S1 badge card SVG composers"
```

---

### Task 6: Download pipeline + QrCardModal + whoami button

**Files:**
- Create: `apps/run.human/webapp/src/components/qr/downloadCardPng.ts`
- Create: `apps/run.human/webapp/src/components/qr/QrCardModal.tsx`
- Modify: `apps/run.human/webapp/src/app/(protected)/whoami/page.tsx` (Social QR panel: add button + modal)

**Interfaces:**
- Consumes: `composeWallpaperSvg`/`composeShareCardSvg`/`WALLPAPER`/`SHARECARD`/`CardCopy` (Task 5), `renderStyledQr` + `buildQrPayload` (Tasks 2–3), `/header/bunny-head-alpha.png` (Task 1).
- Produces: `<QrCardModal isOpen onClose hash name bib copy />`; `downloadCardPng(svg: string, w: number, h: number, filename: string): Promise<void>`.

- [ ] **Step 6.1: Download util**

```ts
// src/components/qr/downloadCardPng.ts
/** Rasterize an SVG document to PNG on-device and trigger a download. */
export async function downloadCardPng(
  svg: string,
  w: number,
  h: number,
  filename: string,
): Promise<void> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetch a same-origin asset as a data URI (SVG-in-<img> can't load external refs). */
export async function assetAsDataUri(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`asset fetch failed: ${path}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
```

- [ ] **Step 6.2: Modal**

```tsx
// src/components/qr/QrCardModal.tsx
'use client';

import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, Button,
} from '@heroui/react';
import { Smartphone, Share2 } from 'lucide-react';
import { buildQrPayload } from './buildQrPayload';
import { renderStyledQr } from './renderStyledQr';
import {
  composeWallpaperSvg, composeShareCardSvg, WALLPAPER, SHARECARD, type CardCopy,
} from './composeCards';
import { downloadCardPng, assetAsDataUri } from './downloadCardPng';
import { getApiBasePath } from '@/lib/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  hash: string;
  name: string;
  bib: string | null;
  copy: CardCopy & { optionWallpaper: string; optionShare: string };
}

export default function QrCardModal({ isOpen, onClose, hash, name, bib, copy }: Props) {
  const [busy, setBusy] = useState<'wallpaper' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (kind: 'wallpaper' | 'share') => {
    setBusy(kind);
    setError(null);
    try {
      const qrSvg = renderStyledQr(buildQrPayload(hash));
      const bunnyDataUri = await assetAsDataUri(
        `${getApiBasePath()}/header/bunny-head-alpha.png`,
      );
      const args = { qrSvg, name, bib, bunnyDataUri, copy };
      if (kind === 'wallpaper') {
        await downloadCardPng(
          composeWallpaperSvg(args), WALLPAPER.w, WALLPAPER.h, 'defcon-run-qr-wallpaper.png',
        );
      } else {
        await downloadCardPng(
          composeShareCardSvg(args), SHARECARD.w, SHARECARD.h, 'defcon-run-qr-card.png',
        );
      }
      onClose();
    } catch (e) {
      console.error('QR card download failed:', e);
      setError('Download failed — try again or screenshot the QR above.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center">
      <ModalContent>
        <ModalHeader className="font-museo">Save QR card</ModalHeader>
        <ModalBody className="pb-6 space-y-3">
          <Button
            color="primary" variant="flat" size="lg"
            startContent={<Smartphone className="w-5 h-5" />}
            isLoading={busy === 'wallpaper'} isDisabled={busy !== null}
            onPress={() => save('wallpaper')}
          >
            {copy.optionWallpaper}
          </Button>
          <Button
            color="secondary" variant="flat" size="lg"
            startContent={<Share2 className="w-5 h-5" />}
            isLoading={busy === 'share'} isDisabled={busy !== null}
            onPress={() => save('share')}
          >
            {copy.optionShare}
          </Button>
          {error && <p className="text-tiny text-danger">{error}</p>}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 6.3: whoami wiring.** In `src/app/(protected)/whoami/page.tsx`:
  - Imports: `import QrCardModal from '@/components/qr/QrCardModal';`
  - State: `const [isCardModalOpen, setIsCardModalOpen] = useState(false);`
  - Copy resolution next to the existing `asUrl` helper (same default-floor idiom — `t()` echoes the key when unset):

```tsx
const copyOr = (key: string, fallback: string) => {
  const v = t(key);
  return !v || v === key ? fallback : v;
};
const qrCardCopy = {
  tagline: copyOr('qrcard.tagline', 'SCAN TO CONNECT'),
  prompt: copyOr('qrcard.prompt', '$ defcon.run/connect_'),
  wordmark: copyOr('qrcard.wordmark', 'DEF CON 34'),
  site: copyOr('qrcard.site', 'defcon.run'),
  optionWallpaper: copyOr('qrcard.option.wallpaper', 'Lock-screen wallpaper'),
  optionShare: copyOr('qrcard.option.share', 'Share card'),
};
```

  - Inside the expanded QR section (below the `<p ...>Share this QR code...</p>` line), add — gated on `userData.hash`:

```tsx
{userData.hash && (
  <>
    <Button
      size="sm" color="primary" variant="flat"
      startContent={<Download className="w-4 h-4" />}
      onPress={() => setIsCardModalOpen(true)}
    >
      {copyOr('qrcard.button', 'Save QR card')}
    </Button>
    <QrCardModal
      isOpen={isCardModalOpen}
      onClose={() => setIsCardModalOpen(false)}
      hash={userData.hash}
      name={userData.displayName || userData.displayname || 'RUNNER'}
      bib={userData.runnerCode ? userData.runnerCode.toUpperCase() : null}
      copy={qrCardCopy}
    />
  </>
)}
```

  - Add `Download` to the existing `lucide-react` import; `Button` to the HeroUI import if not already there. Check the actual `UserData` field for display name in this file (it maps `displayName`→`displayname`) and use whichever the interface declares.

- [ ] **Step 6.4: Verify**

Run: `npx vitest run src/components/qr && npm run lint && npm run build`
Expected: all PASS/clean.

- [ ] **Step 6.5: Manual download check.** `PORT=3001 npm run dev`, sign in, whoami → Your Social QR → Save QR card → download BOTH formats. Open each PNG: wallpaper is 1080×1920 with clear top; card is 1080×1080 badge; both QRs phone-scan to your `/r?h=` URL; bunny ghost visible (transparent, not a black box).

- [ ] **Step 6.6: Commit**

```bash
git add src/components/qr/downloadCardPng.ts src/components/qr/QrCardModal.tsx "src/app/(protected)/whoami/page.tsx"
git commit -m "feat(human): Save QR card modal — wallpaper + badge PNG downloads"
```

---

### Task 7: Full gates + PR

**Files:** none new.

- [ ] **Step 7.1:** Full test run: `nvm use 23.6.0 && npx vitest run` — Expected: ALL tests pass (new + existing).
- [ ] **Step 7.2:** `npm run lint && npm run build` — Expected: clean.
- [ ] **Step 7.3:** Push + PR (from repo root):

```bash
git pull --rebase && git push -u origin feat/runner-qr-card
gh pr create --title "feat(human): styled runner QR + downloadable wallpaper/share card" --body "$(cat <<'EOF'
## Summary
- Styled DC34 runner QR (square modules, magenta 34-eyes, DC jack center, EC-H) replaces the plain eqr PNG on whoami + header dropdown (eqr kept as fallback)
- "Save QR card" modal on whoami: W1 Terminal lock-screen wallpaper (1080x1920) + S1 Badge share card (1080x1080), rendered client-side to PNG
- Card copy CMS-editable via qrcard.* keys with hardcoded defaults (seeding = separate deploy-time step)
- One-time asset: bunny-head-alpha.png (luminance->alpha)

Spec: docs/superpowers/specs/2026-07-12-runner-qr-card-design.md

## Test plan
- [ ] vitest: payload byte-parity guard, renderer invariants, composer contents
- [ ] Signed-in: whoami + dropdown QRs render styled and phone-scan
- [ ] Both downloads phone-scan and look right (wallpaper clock zone clear)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Do NOT merge — wait for explicit user approval.

- [ ] **Step 7.4:** Report the PR link and the remaining human steps: signed-in visual verify, phone-scan acceptance on real devices, Strapi key for copy seeding.

---

### Task 8 (deferred, post-merge): CMS copy seeding

Not executable until Kurt provides the Strapi API key. When he does: add the seven `qrcard.*` keys (values = the code defaults above) via the established copy-import flow (`npm run copy:import` / scripts/import-copy.mjs), scoped write only — never re-seed existing keys; master write target is cms.defcon.run/use1.
