# Landing-page quick actions — design

**Date:** 2026-08-02
**App:** `run.human` (`run.defcon.run`)
**Status:** approved

## Problem

The signed-in landing page (`src/app/(public)/page.tsx`) offers only two CTAs —
`Who Am I` and `Routes`. The three actions a runner actually performs during the
event (check in, log a run, scan another runner) are reachable only from
`/whoami`, one navigation away. The landing page is where runners arrive.

## What ships

Three additional CTAs in the signed-in hero, below `Routes`, in this order:

| Button | Icon | Action |
|--------|------|--------|
| **Check-in** | `MapPin` | Opens `QuickCheckInModal` — the existing one-tap flow ("Fast public check-in / Posts your location to the live map") |
| **Add Run** | `Footprints` | New tab → `https://gpx.{siteDomain}/{region}/studio/app?addrun` |
| **Scan** | `Camera` | Opens `QrScannerModal` — camera runner-QR scanner |

All three flows already exist and are wired on `/whoami`. This adds a second
entry point; it introduces no new behaviour, no new API routes, and no new
server-side capability.

The buttons render only inside `WelcomeContent`, which mounts only when
`session?.user` is truthy. Session gating is therefore structural — there is no
separate auth check to get wrong.

## Hero restructure

The hero `Card` is `h-[420px]` and its content sits in an `absolute inset-0`
overlay, so the content contributes zero height and five buttons would overflow.
Invert the layering so the card grows with its content:

- `Card` — `h-[420px]` → `min-h-[420px]`
- `Image` — gains `absolute inset-0`, stays `z-0 object-cover brightness-[.55]`
- content `div` — `absolute inset-0 z-10` → `relative z-10`, normal flow, with
  vertical padding and bottom padding sufficient to clear the `CardFooter`
  caption strip

Desktop is visually unchanged: `flex-wrap justify-center` lays the five 190px
buttons out over two rows inside the existing 420px floor. Mobile grows to
roughly 560px.

## Shared extraction

Two pieces would otherwise be copy-pasted between `/whoami` and the landing
page. Both become pure modules under `src/lib/`, which is also the only
testable surface available (see Testing).

### `lib/gpx-addrun.ts` — `gpxAddRunUrl(): string`

Returns the dev (`http://localhost:3003/studio/app?addrun`) or prod
(`https://gpx.{siteDomain}/{region}/studio/app?addrun`) URL.

Worth isolating rather than inlining twice: `/{region}/studio/app` is the only
terminal path on the gpx origin. A deep link to bare `gpx.defcon.run` hits an
interstitial that does `location.replace('/' + region + '/')`, dropping both the
query string and the hash — the `?addrun` payload disappears and the failure is
silent. One function, one test, both callers.

### `lib/scanner-copy.ts` — `buildScannerCopy(copyOr): ScannerCopy`

Builds the eight-field `ScannerCopy` object (`title`, `hint`, `miss`, `found`,
`claim`, `again`, `unavailable`, `cancel`) from a
`(key: string, fallback: string) => string` resolver. `/whoami` currently builds
this inline; after this change both pages import it.

`/whoami` is refactored to consume both modules. Its rendered behaviour does not
change.

## Labels and CMS keys

- **Check-in** — reuses the existing `checkin.quick.button` (default
  `Check-in`), so both entry points always read the same word.
- **Add Run** — hardcoded, matching `/whoami`.
- **Scan** — uses a **new** key `socialqr.scan.button.short` (default `Scan`).

The Scan button deliberately does *not* reuse `socialqr.scan.button`, which
drives `/whoami`'s "Connect" label. Sharing the key would let a single CMS edit
silently rename both buttons, and the two labels are intentionally different:
the profile names the outcome ("Connect"), the landing page names the mechanism
("Scan") because it sits beside four other navigational CTAs.

## Data the modals need

`QuickCheckInModal` accepts `checkinPreference` (selects private vs. public
wording) and `QrScannerModal` accepts `attendanceAvailable` (shows the
admin/runadmin attendance toggle). The landing page holds neither today.

`WelcomeContent` issues one non-blocking `GET /api/user` on mount — the same
call `/whoami` already makes — and retains exactly two fields:
`preferences.checkinPreference` and `!!social.attendance`.

Buttons render immediately and never await this request. If it fails, or has not
resolved when a modal opens, the modal falls back to public wording and no
attendance toggle.

**That fallback is cosmetic only.** `QuickCheckInModal` POSTs a body whose keys
are exactly `["samples", "source"]`; `POST /api/checkins` resolves privacy from
the runner's stored preference server-side. A slow or failed fetch can therefore
show a private runner the wrong wording for a moment, but cannot make their
check-in public. Nothing in this change may start sending `isPrivate` from the
client — doing so would let the fast path diverge from the runner's settings.

## Error handling

Handled entirely inside the existing modals, unchanged by this work:

- GPS permission denied / unavailable → in-modal message and retry
- Camera unavailable → "Camera unavailable - use your phone's camera app on the
  QR instead."
- Check-in POST failure → in-modal error state
- `/api/user` failure on the landing page → swallowed; defaults apply as above

## Testing

`run.human` has no jsdom and no `@testing-library/react`; all suites are
node-environment logic tests. No component-render tests are planned. Coverage
comes from the extracted pure modules:

- `lib/__tests__/gpx-addrun.test.ts` — dev and prod shapes; asserts the path
  ends in `/studio/app?addrun` and that the URL is never the bare gpx origin
- `lib/__tests__/scanner-copy.test.ts` — all eight fields present; resolver
  overrides win over fallbacks
- a guard asserting the landing page sources its Add Run href from
  `gpxAddRunUrl()` rather than an inline gpx URL

The existing `lib/__tests__/quick-checkin.test.ts` assertion that the POST body
keys are exactly `["samples", "source"]` continues to guard the privacy
omission described above.

Run with `nvm use 22.12.0` then `npx vitest run` (there is no `test` script).

## Out of scope

- Changing `/whoami`'s action-bar appearance or labels
- Any change to check-in privacy semantics or the scoring engine
- Showing these actions to signed-out visitors
