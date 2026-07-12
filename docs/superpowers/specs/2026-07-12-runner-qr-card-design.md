# Runner QR Card — styled QR + downloadable wallpaper/share card

**Date:** 2026-07-12
**App:** `apps/run.human` only (no backend/infra changes)
**Status:** Approved by Kurt via visual-companion mockup session (screens in `.superpowers/brainstorm/`, generator scripts in session scratchpad)

## Problem

The runner "Social QR" lives behind auth on the whoami page — showing it to another
runner at the con requires connectivity, a live session, and navigation. A wallet
pass (Apple/Google/Samsung) was considered and rejected: every option needs paid
developer accounts and/or issuer approval processes not currently in place. A
downloadable, DC34-branded QR card gets ~80% of the value (offline, on-device,
lock-screen-able) for a fraction of the effort — and doubles as a fun share artifact.

## Decisions (locked with Kurt)

1. **QR style "B2"** — square ink modules; rounded **magenta finder eyes with a
   white "34" in each pupil**; magenta DC jack logo in a center knockout; error
   correction H. Chosen over the scanner-safe "stealth 34" (magenta-on-ink pupils)
   with the risk understood — see Risks.
2. **Scope: download + site.** The styled QR replaces the plain stored `eqr` PNG
   on the whoami "Your Social QR" panel and the header-dropdown QR. Strava/Signal
   tiles are untouched.
3. **Two download formats, user picks in a modal:**
   - **W1 "Terminal" wallpaper, 1080×1920** — near-black bg with faint mint
     scanlines, top ~28% left clear for the lock-screen clock, mint prompt line
     `$ defcon.run/connect_` (magenta `connect`), white QR panel, display name,
     magenta `🎽 BIB-XXXX`, letter-spaced tagline, ghost bunny wireframe rising
     from the bottom edge at ~10% opacity.
   - **S1 "Badge" share card, 1080×1080** — conference-badge conceit: punched
     lanyard hole top-center, dashed mint inner frame, QR panel left, identity
     block right (DEF CON 34 wordmark, defcon.run in mint, display name, magenta
     bib line, tagline, small bunny sign-off).
4. **Tagline: "SCAN TO CONNECT"** — this and the other card strings are
   CMS-editable with hardcoded code defaults (default-floor pattern, as in the
   socials QR row).
5. Colors: ink `#111118`, magenta `#c4157a`, mint `#3df2c4`, card bg `#080a0e`.
   Modules stay near-black (scanners binarize; mint is too light to be "ink" —
   mint only appears in card chrome, never inside the QR).

## Architecture

All client-side in `apps/run.human/webapp`. One rendering pipeline, two consumers:

```
userData.hash ──► buildQrPayload() ──► qrcode.create(payload, {EC:'H'})   [module matrix]
                                            │
                                   renderStyledQr(matrix, opts) ──► SVG string
                                            │                          │
                              on-screen <img src=svg-data-uri>   card composer (SVG 1080×1920 / 1080×1080)
                                                                       │
                                                          rasterize → canvas → PNG blob → download
```

### Components

- **`components/qr/buildQrPayload.ts`** (pure) — reconstructs the exact URL the
  stored `eqr` encodes: `https://run.<domain>/<region>/r?h=<hash>`. Must be
  byte-identical to `entities/run-user.ts:197`. Built from `userData.hash` plus
  the region-aware base URL (same helper family as `apiUrl()`); NOT from
  `window.location` alone if that could disagree with the canonical host.
- **`components/qr/renderStyledQr.ts`** (pure) — module matrix → SVG string.
  Ports the mockup generator: quiet zone 3, square modules as one `<path>`,
  skip finder zones / center knockout, rounded-rect eyes (outer magenta rx 2.1,
  white ring, magenta 3×3 pupil rx 1) with white "34" text centered in each
  pupil, DC jack `<path>` (inlined from `public/header/dcjack.svg`) in the
  center knockout (~24% span, even/odd-matched to grid parity).
- **`components/qr/StyledRunnerQr.tsx`** — client component: takes `hash`,
  renders the SVG inline (or as data-URI img). Falls back to the stored `eqr`
  PNG when `hash` is absent. Used by whoami page + `dropdown-user.tsx`.
- **`components/qr/QrCardModal.tsx`** — HeroUI modal opened from a "Save QR
  card" button in the whoami Social QR panel. Two options (Wallpaper / Share
  card) with tiny previews; clicking composes the full-res SVG card, rasterizes
  via `Image` + `canvas.toBlob('image/png')`, and triggers an `<a download>` of
  `defcon-run-qr-{wallpaper|card}.png`. Uses display name + bib code
  (`userData.runnerCode`); bib line omitted when no bib claimed.
- **Card composition** — both cards are single SVG documents (rects, gradients,
  `<text>`, `<image>`, the QR `<g>`): one rasterization path, no HTML/CSS
  dependency. Scanlines = `<pattern>`; monospace stack
  `ui-monospace, Menlo, monospace` (system fonts render at raster time on the
  user's own device, so no font embedding needed).

### Asset preprocessing (one-time, committed)

`public/header/bunny-head.png` is white wireframe on **opaque black**; the ghost
treatment needs transparency. Preprocess once (luminance→alpha) to
`public/header/bunny-head-alpha.png` and commit. Mockups used CSS
`mix-blend-mode:screen` — not reliable through SVG rasterization, hence the
preprocessed asset.

### CMS copy keys (default-floor pattern)

Follow the existing run.human ui-string catalog pattern (code default wins when
CMS key absent — same as `socials.*` in the whoami row). New keys:

| Key | Default |
|---|---|
| `qrcard.tagline` | `SCAN TO CONNECT` |
| `qrcard.prompt` | `$ defcon.run/connect_` |
| `qrcard.wordmark` | `DEF CON 34` |
| `qrcard.site` | `defcon.run` |
| `qrcard.button` | `Save QR card` |
| `qrcard.option.wallpaper` | `Lock-screen wallpaper` |
| `qrcard.option.share` | `Share card` |

Rendering rule for `qrcard.prompt`: the string is stored as plain text and drawn
in mint; if it contains a `/`, the segment after the **last** `/` is drawn in
magenta (so the default shows `connect_` accented, and CMS edits keep working
without markup).

Seeding into prod Strapi is a deploy-time step — Kurt provides the API key when
ready; until then defaults render. Respect the copy-sweep landmines: scoped
write, never re-seed existing keys, master write = cms.defcon.run/use1.

## Error handling

- No `hash` on the user record → Social QR panel behaves exactly as today
  (stored `eqr` PNG, no download button).
- Canvas/blob failure (ancient browser) → toast-level error; on-screen QR is
  unaffected.
- CMS unavailable → hardcoded defaults (this is the normal path until seeded).

## Testing

- **Unit (vitest, colocated like `buildTiles.test.ts`):**
  - `buildQrPayload` — byte-identical to the server-side format for a fixture
    hash/region/domain.
  - `renderStyledQr` — invariants on a fixture matrix: 3 eyes with "34" text
    present; no modules drawn inside finder zones or center knockout; timing
    row/col preserved outside knockout; output is parseable SVG.
- **Acceptance (manual, signed-in):** whoami QR and BOTH downloaded PNGs scan
  with iPhone and Android cameras and resolve to the runner's `/r?h=` URL;
  wallpaper set as an actual iOS lock screen leaves the clock readable.
  (Landmine reminder: whoami is auth-gated — verification needs a real session,
  curl-grep proves nothing.)

## Risks & fallbacks

- **White "34" pupils damage the finder patterns** (finder zones carry no error
  correction). Accepted knowingly; modern phone cameras tolerate it (validated
  on the mockup screen). Fallback is a one-line change: pupil ink `#111118`
  with magenta "34" (the "stealth" B1 variant, scanner-indistinguishable from
  solid pupils).
- **Payload drift** — if `buildQrPayload` ever disagrees with
  `run-user.ts:197`, scans route wrong. Locked by the byte-identical unit test.
- **Center logo + pupils EC budget** — knockout ≈ 5–6% of modules, well inside
  EC-H's ~30%; do not add further stamps without re-checking.

## Out of scope

- Wallet passes (Apple/Google/Samsung) — revisit post-con if demand shows;
  Google Wallet is the cheap upgrade path.
- Restyling Strava/Signal QR tiles.
- Any change to `eqr` generation, the `/r` resolver, or run-user storage.
