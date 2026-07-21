# run.gpx — Strava last-7-days strip, con-day save dialog, and My DEF CON Runs layer

**Date:** 2026-07-21
**Status:** Approved (Kurt, 2026-07-21) — overnight autonomous build, PR for morning review
**Mockup:** https://claude.ai/code/artifact/37fd049d-bccb-4912-9fe0-89bd2068bb78

## Summary

Three related features in `apps/run.gpx`:

1. **Strava strip** — a collapsible carousel docked across the bottom of the gpx-studio
   map editor showing the runner's last 7 days of Strava activities (rolling window,
   anything with GPS). Cards render the activity polyline as a thumbnail; tapping one
   imports that single activity as a real runner file and drops it on the map.
2. **"Save as defcon.run Activity"** — a dialog on any map file that assigns (or
   reassigns) which DEF CON day the run counts toward, via day chips with a guessed
   default. Any con day is choosable at any time.
3. **"My DEF CON Runs" layer** — a read-only toggleable map layer (public-overlays
   pattern) rendering the runner's own con-day-tagged files, grouped by day.

Builds on the shipped per-user Strava sync (phases 59–64): token plumbing via run.auth
internal endpoint, `stravaGet()` + rate-limit telemetry, streams→GPX synthesis, dedupe
by `stravaActivityId`, con-day quota. See
`docs/superpowers/specs/2026-07-16-gpx-runner-file-ux-design.md`.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Import model | Direct import to files (tap → real `GpxFile`, shows on map via normal flow) |
| Activity types | Everything with GPS (no type filter; skip GPS-less e.g. treadmill) |
| Placement | Bottom strip on the map editor, carousel with ‹ › arrows (~14 cards possible) |
| Not linked / empty | "Connect Strava" CTA card in the strip; "no activities in the last 7 days" note when linked but empty |
| Quota | Counts against the 10/con-day cap + `gpx_upload` lifetime, same as uploads; imported cards get a ✓ badge and are inert |
| Existing hub button | "From Strava" in the Log-a-run hub stops bulk-importing; it closes the hub and opens/expands the strip |
| Day on import | Confirm popover: one chip per con day (6), best-guess pre-selected, remaining quota shown, then "Import run" |
| Day choosability | ANY con day is selectable right now (server validates `isConDay`, not `isSelectableConDay`) in the new popover and save-as dialog |
| Save-as-DEF-CON-run | In scope for this build (was follow-up); same chip dialog, reassignment allowed |
| My-runs layer | In scope for this build; read-only overlay grouped by con day |

## Feature 1 — Strava strip

### API: `GET /api/gpx/strava/activities`

New route in `apps/run.gpx/webapp/src/app/api/gpx/strava/activities/route.ts`.

- Guard stack identical to `strava/sync`: session (`session.user.id`), `gpxstudio`
  service, `hasStrava`, live-lockout check.
- Consumes one `strava_sync` burst-quota unit per call (refund on upstream failure) —
  same protection budget the bulk sync uses.
- Fetches the user token via `fetchSingleUserStravaToken()` (run.auth internal
  endpoint, auto-refresh).
- Calls `GET /athlete/activities?after=<now − 7 days, unix seconds>&per_page=50`
  through the existing `stravaGet()` so the locked `strava.ratelimit` telemetry keeps
  emitting. Page until an empty page, max 3 pages (7 days can't reasonably exceed 150).
- Filters to activities with a non-empty `map.summary_polyline` (= "has GPS").
- Cross-references the user's existing `stravaActivityId`s (same query the sync dedupe
  uses) to mark `imported`.
- Response:
  ```json
  { "ok": true, "activities": [
      { "id": 123, "name": "Morning Run", "type": "Run",
        "startDateLocal": "2026-08-07T06:31:00Z", "distanceMeters": 5400,
        "movingTimeSeconds": 1890, "summaryPolyline": "<encoded>",
        "imported": false }
  ] }
  ```

### API: `POST /api/gpx/strava/import`

New route, body `{ activityId: number, conDay: "YYYY-MM-DD" }`.

- Same guard stack as above.
- `conDay` must pass `isConDay()` (admins may pass any `isValidDateString`). No
  selectable-day gating.
- Duplicate (`stravaActivityId` already on a non-failed file) → 409.
- Con-day cap check (`isConDayCapped`) → 429 with `conDayRemaining`.
- Consume one `gpx_upload` lifetime quota unit, refund on any failure after consume.
- Import engine: refactor the per-activity core out of `syncUserToConDay()` in
  `apps/run.gpx/webapp/src/lib/strava-sync.ts` into an exported
  `importOneActivity(token, userId, activity, conDay)` used by BOTH the bulk sync and
  this route — streams fetch, `buildGpx()`, S3 put, `GpxFile.create` with
  `source: "strava"`, `stravaActivityId`, `conDay`, `publicShareEligible: false`.
  No-GPS at streams time → 422 + quota refund.
- Response: `{ ok, file, conDayRemaining, quotaRemaining }` where `file` matches the
  descriptor shape `logRunFromStrava()` already consumes.

### UI: `StravaStrip.svelte` (gpx-studio)

New component in `apps/run.gpx/gpx-studio/website/src/lib/components/`, docked at the
bottom of the map view (above map attribution, below any open dialogs).

- **Header row:** Strava mark, "From Strava · last 7 days", activity count, collapse
  chevron. Collapsed state = header row only; persisted in localStorage
  (`stravaStripCollapsed`).
- **Carousel:** horizontally paged card row with ‹ › arrow buttons (disabled/dimmed at
  the ends). Cards ~148px: polyline thumbnail (decode Strava's encoded polyline —
  small inline decoder, no new dependency — normalize to the card viewBox, render as
  a single SVG path), type chip (RUN/RIDE/WALK…), name (ellipsized), local date,
  distance in km. Imported cards: dimmed, green "✓ IMPORTED" badge, non-interactive.
- **States:** not linked (`!$hasStrava`) → "Connect Strava" CTA card that sends the
  user through the run.auth Strava link flow and back to the editor; linked + zero
  activities → "No activities in the last 7 days"; fetch error → compact retry row.
- **Data fetch:** on first expand (not on page load), and via a small refresh control;
  no polling.
- **Tap flow:** card → con-day confirm popover anchored to the card: activity name +
  distance, one chip per `CON_DAYS` entry (currently 6: Wed Aug 5 – Mon Aug 10; the
  mockup showed 4 — code is authoritative) with the guessed day highlighted,
  "Fri: 7 of 10 runs left" quota line, Cancel / Import run. On success: existing chain from `strava-import.ts` —
  `loadFromCloud(fileId)` → parse → `fileActions.addMultiple` → register auto-save →
  select + fit bounds; card flips to imported state.
- **Day guess:** activity `start_date_local` date part; if it's a con day use it,
  otherwise the nearest con day (before/after by absolute distance, ties → earlier).
  Shared helper, unit-tested, reused by feature 2.
- **Hub rewire:** `QuickStartHub.svelte`'s "From Strava" button no longer calls
  `logRunFromStrava()`; it closes the hub and expands/scrolls-into-view the strip.
  The now-unused client bulk helper `logRunFromStrava()` is removed (its
  per-file load/parse/add chain is extracted for reuse by the strip's single-import
  path). The server routes `/api/gpx/strava/sync` (per-user) and the EventBridge
  batch pipeline remain untouched.

## Feature 2 — "Save as defcon.run Activity"

- Entry points: context/menu action on a loaded map file (file menu and/or My Maps row)
  labeled **"Save as defcon.run Activity"**.
- Dialog: same day-chip pattern as the import popover. Guessed default: first GPX
  track point timestamp if present, else the file's `createdAt`; guess logic shared
  with feature 1. Shows current assignment if the file already has a `conDay`
  ("Currently: Fri Aug 7").
- Any con day choosable now (no selectable-day gating).
- **API:** `PATCH /api/gpx/files/[id]` accepting `{ conDay }` (extend the existing
  file route family). Validation: owner-only, `isConDay` (admin: any valid date),
  target-day cap check when setting or moving — moving a file from day A to day B
  requires remaining budget on B (the count on A frees implicitly since counts are
  computed by filter). 429 with per-day remaining when the target is full.
- On success, the client updates the file's local metadata and the My-DEF-CON-runs
  layer refreshes.

## Feature 3 — "My DEF CON Runs" layer

- Follows the read-only overlay pattern of `public-overlays.ts` /
  `PublicOverlays.svelte` (glow + core MapLibre line layers, master + per-item
  toggles) — NOT editable file entries.
- New group in the layer control: **"My DEF CON Runs"**, one toggle per con day that
  has at least one run, day-colored lines (fixed 4-color ramp), plus a group master
  toggle. Empty state: group hidden entirely.
- **Data:** client lists the user's files (existing `GET /api/gpx/files`) filtered to
  `conDay != null` + `status active`, then fetches each track via the existing cloud
  file download path and parses to GeoJSON client-side (parser already in studio).
  Cap: at most 10/day × con days — small. No new server endpoint unless the existing
  download path proves awkward; if so, add a thin
  `GET /api/gpx/files/me/con-runs` manifest that mirrors the public-maps manifest
  shape.
- Layer refreshes after any import or save-as-DEF-CON-run change.

## Error handling

- Strava 429 / 5xx on list → strip retry row; on import → toast + `gpx_upload` refund.
- Token missing/revoked (401 from Strava after refresh attempt) → treat as not-linked:
  strip shows the Connect CTA with a "reconnect" message.
- Quota full on target day → popover/dialog shows the 429 message inline with per-day
  remaining, chips stay open so the user can pick another day.
- All new routes: same structured error JSON shape as existing gpx routes.

## Testing

- **Unit (vitest, Node ≥ 22.12):** 7-day window math; day-guess (con day exact,
  nearest, tie, out-of-range); polyline decoder against known Strava fixtures;
  dedupe/imported flagging; con-day move cap logic.
- **Route tests:** activities list (guards, filtering, imported flags, quota consume/
  refund), import (dup 409, cap 429, no-GPS 422 + refund, happy path), PATCH conDay
  (owner check, cap on move).
- **Existing suites stay green** — especially strava-sync tests, since
  `importOneActivity()` is extracted from `syncUserToConDay()`.
- Build gates: `npm run build` for webapp; gpx-studio frontend build
  (`./build-frontend.sh`).

## Out of scope

- Changing the EventBridge batch sync or its date-band envs.
- Strava webhook/live updates, polling.
- Sharing/aggregate behavior changes (`publicShareEligible` stays false for Strava
  imports until converted, as today).
- run.auth changes (scope `activity:read` and the internal token endpoint already
  suffice).
