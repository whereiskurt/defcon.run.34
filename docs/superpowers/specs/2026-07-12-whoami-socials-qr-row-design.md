# whoami Socials + Runner QR row — design

**Date:** 2026-07-12
**App:** run.human (`run.defcon.run/whoami`)
**Status:** approved, ready to implement

## Problem

The whoami identity card (avatar + name/email/mqtt/bib) leaves the right half of
the card empty (see the `max-w-[900px]` single-column card). DC33 surfaced a
Strava Group and a Signal Group link; DC34 has neither. Runners also have a
personal "social QR" (`eqr`) that today is only reachable via a collapsed card
lower on the page and a header-dropdown item.

## Goal

Fill the empty right side of the identity card with a row of three QR tiles —
**Strava Group**, **Signal Group**, **Runner** — each a scannable QR with a short
label. Strava/Signal tiles are also tap-to-open links; the Runner tile shows the
user's existing `eqr` (display-only).

## Scope

In scope:
- New presentational client component `SocialQRRow`.
- Mount it in the whoami identity card, right of the avatar/text block.
- Two new CMS copy keys for the group URLs, with a committed snapshot floor.

Out of scope (explicitly unchanged):
- The lower collapsible "Your Social QR" card — **kept as-is**.
- The header dropdown "Show My QR" — **kept as-is**.
- The `eqr` generation pipeline in `run-user.ts` — reused, not touched.
- Seeding the real URLs into Strapi — a runtime/CMS action, not code.

## Design

### Component: `src/components/profile/SocialQRRow.tsx` (client)

Props:
```ts
interface SocialQRRowProps {
  stravaUrl?: string;   // from copy: socials.strava_group_url
  signalUrl?: string;   // from copy: socials.signal_group_url
  runnerQr?: string;    // the eqr data-URL (already generated server-side)
}
```

Renders a `flex flex-wrap` row of up to three tiles. Each tile is a white-bg
rounded box holding a ~100px QR image and a small label beneath:

| Tile   | QR source                              | Wrapper                                  |
|--------|----------------------------------------|------------------------------------------|
| Strava | generated in-browser from `stravaUrl`  | `<a href target=_blank rel=noopener>`    |
| Signal | generated in-browser from `signalUrl`  | `<a href target=_blank rel=noopener>`    |
| Runner | `runnerQr` (`eqr`) — used directly     | plain `<div>` (display-only, nothing to open) |

Labels are hardcoded: `Strava`, `Signal`, `Runner` (they will not change; no
catalog plumbing for them).

### Tile-selection logic — pure helper (testable)

Extract a pure function so presence/link logic is unit-testable without the async
QR encode or the DOM:

```ts
type Tile =
  | { kind: 'link'; label: string; url: string }      // strava, signal
  | { kind: 'image'; label: string; src: string };     // runner (eqr)

export function buildTiles(props: SocialQRRowProps): Tile[]
```

Rules:
- Include Strava tile only when `stravaUrl` is a non-empty string.
- Include Signal tile only when `signalUrl` is a non-empty string.
- Include Runner tile only when `runnerQr` is a non-empty string.
- Order: Strava, Signal, Runner.
- Empty array → component renders `null` (right side stays empty; no layout shift).

### QR generation

`qrcode` (already a dependency, used by `run-user.ts`) runs client-side. In a
`useEffect`, for each `link` tile, `qrcode.toDataURL(url, { errorCorrectionLevel:
'M', width: 220, margin: 1 })` and hold the resulting data-URLs in state keyed by
url. Render a tile's `<img>` once its data-URL is ready (until then, a fixed-size
placeholder box prevents layout shift). The Runner tile needs no generation — its
`src` is the `eqr` data-URL already.

### Layout in the identity card

`whoami/page.tsx` identity card top row becomes:
```
<div className="flex items-center gap-3">
  <Avatar ... />
  <div className="flex flex-col min-w-0 flex-1"> ...name/email/mqtt/bib... </div>
  <SocialQRRow stravaUrl={...} signalUrl={...} runnerQr={userData?.eqr} />
</div>
```
- Desktop: tiles right-aligned next to the text (`flex-1` text column pushes them
  right).
- Mobile: `SocialQRRow` uses `flex-wrap` and, when the row can't sit beside the
  text, wraps under it centered. Keep tiles small enough that up to three fit a
  phone width when wrapped.

### URL source — CMS copy

Two new keys resolved client-side via `useCopy()` in `whoami/page.tsx`:
- `socials.strava_group_url`
- `socials.signal_group_url`

**NOT added to `copy-snapshot.json`.** The `copy-catalog-human` guard test
enforces a deliberate invariant: run.human's snapshot floor carries ONLY the
shared `common.*` chrome union (zero non-chrome keys, D-06 bias-to-defer). So
the socials keys live in the **live CMS context only** (`loadCopy("default")` →
Strapi/S3 → `CopyProvider`), never the offline floor.

Net behavior is identical to a floor of empty strings: when a key is unset,
`useCopy().t(key)` echoes the raw dotted key, which is not an `http(s)` URL, so
the page's `asUrl()` guard maps it to `''` and `buildTiles` omits that tile. On
first deploy (CMS keys unset) only the Runner QR shows; the socials light up the
moment the two rows are added in Strapi — no redeploy.

## Error / edge handling

- Missing/empty URL → tile omitted (handled by `buildTiles`).
- Missing `eqr` → Runner tile omitted.
- `qrcode.toDataURL` rejection → that tile falls back to a plain outbound link
  chip (never throws; never blocks the others). For the Runner tile there is no
  generation to fail.
- No provider/data at all → `SocialQRRow` returns `null`.

## Testing

- Unit (vitest, Node ≥22.12 — `nvm use 23.6.0` first): `buildTiles` returns the
  right tiles/kinds/order for every presence combination (all three, each single,
  none, empty-string vs undefined).
- Build gate: `tsc --noEmit`, lint, `next build`.
- Manual/visual (post-deploy): identity card shows Runner QR; when CMS URLs set,
  Strava/Signal tiles render and open their groups on tap.

## Files

1. `src/components/profile/buildTiles.ts` — pure tile-selection helper.
2. `src/components/profile/SocialQRRow.tsx` — new component (async QR + presentation).
3. `src/components/profile/SocialQRRow.test.ts` — `buildTiles` unit tests.
4. `src/app/(protected)/whoami/page.tsx` — read CMS copy (`asUrl` guard), mount `SocialQRRow`.

No `copy-snapshot.json` change (socials keys are CMS-context-only — see URL source).
