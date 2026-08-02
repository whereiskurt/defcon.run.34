# Whoami quick actions — Connect, fast check-in, flash modal dismissal

**Date:** 2026-08-02
**App:** `run.human`
**Surface:** `/whoami` profile page

## Problem

Three small frictions on the profile page:

1. **"Scan a runner" reads as a feature name, not an act.** The button already carries a
   camera icon and already sits in the action bar (shipped v0.0.135), but the label
   describes the mechanism rather than the outcome. Connecting with another rabbit is
   the point; scanning is how.

2. **Checking in takes too many taps.** The only path is the `+` on the Check-ins card,
   which opens a full modal with a map preview, a pin picker, and a privacy select. All
   of that matters when a runner wants control — none of it matters when they just want
   to mark that they were here.

3. **The Add-Radio modal outstays its welcome.** Its "Goto Flash" button is an
   `<a target="_blank">`; the new tab opens, but the modal is still sitting there when
   the runner comes back.

## Scope

In: the whoami action bar, a new quick check-in modal, a GPS-sampling hook extracted
from the existing check-in modal, and a one-line fix to the Add-Radio modal.

Out: the full `CheckInModal` UX, the Check-ins card `+`, the check-in API contract, the
scanner modal internals, anything on the landing page.

## Design

### 1. Action bar

```
[👣 Add Run]  [📷 Connect]  [📍 Check-in]  [🏆 Leaderboard]
```

`Add Run` keeps its lone loud-green slot. `Connect`, `Check-in`, and `Leaderboard` are
brand-teal `variant="bordered" radius="full"` pills, matching what shipped in v0.0.135.

- **`Connect`** — the existing camera button relabelled. Same `Camera` icon, same
  `QrScannerModal`, same `setIsScannerOpen(true)`. The label comes from the existing CMS
  key `socialqr.scan.button`; only the code-side fallback in `copyOr()` changes from
  `Scan a runner` to `Connect`. If CMS has an explicit value for that key, CMS still
  wins — the copy sweep to update it is a follow-up, not a blocker.
- **`Check-in`** — new. `MapPin` icon, label from a new key `checkin.quick.button`
  (fallback `Check-in`). Opens `QuickCheckInModal`.

`Check-in` is placed between `Connect` and `Leaderboard` so the two presence/social acts
are adjacent.

The Check-ins card `+` and the full `CheckInModal` behind it are unchanged. That remains
the path for a per-check-in pin, a privacy flip, or admin manual coordinates.

### 2. `useGpsSamples()` — `src/hooks/useGpsSamples.ts`

The 3-sample GPS loop currently living inside `CheckInModal` is extracted verbatim so
both modals share one implementation. Its pure parts — the `GpsSample` type,
`toGpsSample()`, `bestAccuracyOf()`, and the timing constants — live in
`src/lib/gps-samples.ts` so they are testable in the node environment; the hook is the
React lifecycle wrapped around them.

```ts
type GpsPhase = 'collecting' | 'ready' | 'error';

function useGpsSamples(isActive: boolean): {
  phase: GpsPhase;
  samples: GpsSample[];      // live copy for render
  samplesRef: RefObject<GpsSample[]>;  // stable copy for submit
  sampleCount: number;
  bestAccuracy: number | null;
  restart: () => void;
}
```

Behavior preserved exactly:

- Three `getCurrentPosition` calls at 667ms spacing, `enableHighAccuracy: true`,
  `timeout: 10000`.
- `bestAccuracy` = min accuracy across the three samples; `phase` flips to `ready` on the
  third.
- A missing `navigator.geolocation`, or any position error, sets `phase: 'error'`.
- Sampling starts when `isActive` goes true and stops when it goes false; an internal
  active-ref guards every async callback so a closed modal writes no state.
- All timeouts are tracked and cleared on deactivate and on unmount.

`CheckInModal` is refactored to consume the hook and keeps everything else it owns — map
preview, pin picker, privacy select, admin manual-coords, its own retry semantics. It
loses roughly 60 lines and gains no behavior change.

`GpsSample` moves next to the hook and is imported by both modals.

### 3. `QuickCheckInModal` — `src/components/QuickCheckInModal.tsx`

```ts
interface QuickCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkinPreference?: string;   // 'private' | anything else
}
```

Centered, `size="sm"`, blur backdrop, big full-width confirm.

**Copy** — driven by `checkinPreference`, via `copyOr()` keys with these fallbacks:

| preference | title | body |
|---|---|---|
| `'private'` | `Fast private check-in` | `Saved to your history only.` |
| anything else | `Fast public check-in` | `Posts your location to the live map.` |

Keys: `checkin.quick.title.public`, `checkin.quick.title.private`,
`checkin.quick.body.public`, `checkin.quick.body.private`, `checkin.quick.confirm`
(fallback `Check in`), `checkin.quick.cancel` (fallback `Cancel`).

**Flow**

1. **Open** — `useGpsSamples(isOpen)` begins sampling immediately and silently. No
   progress bar; the confirm question is the whole body. This is the warm start: by the
   time the runner reads the line and presses the button, the fix is usually in hand.
2. **Confirm** — if `phase === 'ready'`, submit at once. If still `collecting`, the
   button enters `isLoading` and an effect submits as soon as `phase` flips to `ready`.
   The runner never waits on a gate they can see.
3. **Submit** — `POST /api/checkins` with `{ samples, source: 'Web Quick' }` and nothing
   else. `isPrivate` and the pin are deliberately omitted: the route already resolves
   `isPrivate ?? preferences.checkinPreference === 'private'` and falls back to the
   profile pin, so the fast path cannot drift from the profile. `checkinPreference` is
   used for display only.
4. **Success** — ✓ confirmation, `window.dispatchEvent(new Event('checkin-created'))` so
   the Check-ins card expands and refreshes exactly as it does today, auto-close after
   1500ms.

**Errors** — reuse the existing strings so the two modals speak with one voice:

| condition | message | recovery |
|---|---|---|
| GPS error phase | `Location unavailable -- enable GPS and try again` | `Try again` → `restart()` |
| `429` | `Check-in limit reached for today` | close only |
| other non-ok / throw | `Something went wrong` | `Try again` → resubmit |

**Dismissal** — `isDismissable` is false while submitting, matching `CheckInModal`.

**`source: 'Web Quick'`** — a distinct source value (alongside `Web GPS` and
`Admin Manual`) so fast-path adoption is measurable after the event.

### 4. Add-Radio modal dismissal

`MeshtasticRadios.tsx`, the "Goto Flash" button inside the Add-Radio modal: add
`onPress={closeAdd}`. It stays `as="a" href={flashUrl} target="_blank"`, so the new tab
still opens; HeroUI fires `onPress` on activation and the modal is closed when the runner
returns.

The other Flash button (radio-list empty state) is not in a modal and is not touched.

## Files

| File | Change |
|---|---|
| `src/lib/gps-samples.ts` | new — `GpsSample` type + pure sampling helpers |
| `src/lib/quick-checkin.ts` | new — pure copy resolution, request body, error mapping |
| `src/hooks/useGpsSamples.ts` | new — React lifecycle around `lib/gps-samples` |
| `src/components/QuickCheckInModal.tsx` | new — confirm-and-go check-in |
| `src/components/CheckInModal.tsx` | refactor to use the hook; no behavior change |
| `src/app/(protected)/whoami/page.tsx` | relabel to `Connect`, add `Check-in` button + modal |
| `src/components/profile/MeshtasticRadios.tsx` | `onPress={closeAdd}` on Goto Flash |
| `src/lib/__tests__/gps-samples.test.ts` | new |
| `src/lib/__tests__/quick-checkin.test.ts` | new |

## Testing

**Constraint that shapes this section:** `run.human` has no jsdom and no
`@testing-library/react`. All 115 existing suites are node-environment logic tests, and
the single `.tsx` test inspects a server component's returned element without rendering
it. Adding a DOM-testing stack for this feature is not proportionate.

So the design pushes every decision worth asserting *out* of the components and into two
pure modules, which are then covered properly. What is left in the components is JSX and
React lifecycle — the same thing every other component in this app leaves untested.

**`lib/gps-samples`**
- `toGpsSample()` maps a `GeolocationPosition` to the wire shape
- `bestAccuracyOf()` returns the minimum accuracy, and `null` for an empty list
- `SAMPLE_TARGET` is 3 and `SAMPLE_INTERVAL_MS` is 667 — pins the timing the UX assumes

**`lib/quick-checkin`**
- `quickCheckInCopy()` returns private title/body for `'private'` and public for
  `undefined`, `'public'`, and any unrecognized value
- `buildQuickCheckInBody()` emits exactly `{ samples, source: 'Web Quick' }` — asserted
  key-by-key so `isPrivate`, `pinIcon`, and `pinColor` can never creep in. This is the
  guarantee that the fast path honors the profile.
- `quickCheckInError()` maps 429 to the quota string and anything else to the generic one

**Not covered by automated tests** (and why): the warm-start submit-once-ready path, the
`checkin-created` dispatch, and the `CheckInModal` refactor. These are React lifecycle.
They get a manual pass against a local dev server before merge:

1. `+` on the Check-ins card → full modal still collects 3 samples, map preview renders,
   pin picker and privacy select still work, check-in lands.
2. `Check-in` in the action bar → confirm, check-in lands, history card expands.
3. Press `Check in` immediately on open (before the fix lands) → submits once, not twice.
4. Deny location permission → error state with a working `Try again`.

## Risks

- **Refactoring a working flow.** `CheckInModal` is the only check-in path today. The
  extraction is mechanical and the admin manual-coords branch stays put, but the `+` flow
  gets a manual pass before merge.
- **Double submit.** Confirming during `collecting` arms a deferred submit; a submitted
  ref guards against the effect firing twice. Covered by test.
- **CMS copy.** `socialqr.scan.button` may hold an explicit `Scan a runner` in CMS, which
  would keep the old label live. The code fallback changes regardless; updating CMS is a
  follow-up.

## Out of scope / follow-ups

- CMS copy sweep for `socialqr.scan.button` and the new `checkin.quick.*` keys.
- Test coverage for `CheckInModal` itself.
