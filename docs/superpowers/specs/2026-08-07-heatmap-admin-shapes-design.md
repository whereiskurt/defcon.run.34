# Heat map admin — moderation with eyes

**Date:** 2026-08-07
**App:** run.gpx (`gpx.defcon.run`)
**Surface:** `/admin/heatmap`

## Problem

`/admin/heatmap` lists every con-day run that feeds the public heat map, but it
lists them as *text*. The abuse case the page exists for — a track drawn to spell
something — is a **shape**. An admin cannot see a shape in a table of file names,
so today the only way to find the offending run is to stare at the public map,
pick out the glyph, and then guess which row drew it. The published artifact is
deliberately non-attributable (zero properties per feature, enforced by
`assertNonAttributable`), so that guess cannot be checked.

This closes the loop: put the shape on the moderation row, next to the Delete
button that acts on it.

## Scope

In:

1. A **Shape** thumbnail on every row, rendered from the run's real geometry.
2. **Owner identity** — display name, avatar, provider, lockout/jail state —
   replacing the bare `userId`.
3. **Suspicion signals** — cheap geometric heuristics that surface odd runs
   without eyeballing 300 thumbnails.
4. **Strava payload inspection** — the cached raw activity JSON, inline.

Out (explicitly declined, 2026-08-07):

- Email on this surface. Display name + avatar only.
- Filters / search / sort.
- A full detail drawer. The Strava payload gets a lightweight inline expander
  instead.
- Any live Strava API call. Cache-only.
- A Tailwind/HeroUI migration of this page. It keeps the inline-style
  convention that `HeatmapTable.tsx` and `RoutesTable.tsx` already share.

## Data sources

Nothing new is stored. Every piece already exists somewhere reachable:

| Piece | Source | Cost |
|---|---|---|
| Shape | GPX object in S3 at `bucket`/`key`, parsed by the existing `trkptCoords()` | ~300 S3 GETs, one batched request |
| Owner | `AuthProfile` — a **local run.gpx entity**, keyed by the same `userId` | ~60 DDB gets after dedupe |
| Signals | Derived from the coordinates already read for the shape | free |
| Strava payload | `readStripCache(userId)` joined on `stravaActivityId` | 1 DDB get, on click |

No new DynamoDB attributes, no Strava API traffic, no cross-service calls.

### Why the geometry is one read path

`GpxFile` carries no polyline attribute. `lib/strava-sync.ts` materialises every
Strava import as a real GPX object in S3 at import time, so "GPX upload" and
"Strava import" are the same read: one `GpxFile` row is one run is one S3 object.
This mirrors the note already at the top of `lib/heatmap-build.ts`.

## Architecture

### `src/lib/heatmap-shape.ts` — the pure core

No AWS, no React, no I/O. Coordinates in, render-ready description out.

```ts
export type ShapeSignal =
  | "no-gps" | "drawn-in-place" | "teleport" | "off-site" | "fast";

export type RunShape = {
  path: string;        // SVG path data, normalized to viewBox
  viewBox: string;     // aspect-preserving, e.g. "0 0 100 62"
  points: number;      // ORIGINAL trackpoint count, pre-decimation
  spanMeters: number;  // bbox diagonal
  signals: ShapeSignal[];
};

export function buildRunShape(
  coords: [number, number][],   // [lon, lat], as trkptCoords() emits
  times?: number[],             // epoch ms, optional and best-effort
): RunShape;
```

Decimates to at most `MAX_SHAPE_POINTS` (120) by even stride, always preserving
the first and last surviving point so the shape's endpoints are the run's
endpoints. Normalizes into a box whose aspect ratio matches the run's true
lon/lat extent at that latitude, so a north-south run does not render as a
square. A degenerate (zero-extent) bbox renders as a dot rather than dividing by
zero.

#### Signals

A signal is **a prompt to look, never an action.** Nothing auto-hides, nothing
auto-deletes, and no signal feeds the artifact builder.

| Signal | Rule | Why it matters |
|---|---|---|
| `no-gps` | zero trackpoints | A GPS-less Strava import (treadmill). Legitimate — but it distinguishes "no line to draw" from "the read failed". |
| `drawn-in-place` | bbox diagonal < 500 m **and** ≥ 150 points | A track that folds back on itself inside a tiny area is the glyph-drawing signature. |
| `teleport` | any consecutive-point gap > 1 km | Stitched or synthesised track. |
| `off-site` | any point outside the Las Vegas box (35.8–36.4 lat, −115.5–−114.9 lon) | A run that is not at the con. |
| `fast` | max smoothed speed > 30 km/h | Vehicle-speed. Best-effort: only computed when the GPX carries `<time>`. |

`fast` needs timestamps, so `trkptCoords()` gains a sibling `trkptTimes()` rather
than being changed — the artifact builder's call site must keep its exact current
behaviour.

### `GET /api/gpx/admin/heatmap/shapes`

Admin-gated, 404 for non-admins (non-disclosure, matching every other admin
surface here). Repeats the roster's selection, reads each GPX from S3 chunked at
20 concurrent — the pattern `lib/heatmap-build.ts` already uses — and returns:

```json
{ "shapes": { "<fileId>": { "path": "...", "viewBox": "...", "points": 842,
                            "spanMeters": 310, "signals": ["drawn-in-place"] } },
  "failed": ["<fileId>"] }
```

A per-file read failure lands that fileId in `failed` rather than failing the
whole response — one unreadable object must not blind the whole moderation page.

**Separate from the roster on purpose.** The roster GET stays exactly as fast as
it is today; the table paints immediately and thumbnails fill in when this
lands. Folding the S3 reads into the roster would put ~300 GETs in front of first
paint.

**Process-level cache**, keyed `fileId:updatedAt`, capped at 1000 entries with
oldest-out eviction. The ECS service runs `desired_count 1` with autoscaling off,
so a per-process cache is a real cache and not a coin flip. `updatedAt` in the
key means an edited run re-renders without an explicit invalidation.

### `GET /api/gpx/admin/heatmap/[fileId]/strava?userId=…`

Admin-gated. Reads the user's strip cache and finds the activity whose `id`
matches the row's `stravaActivityId`.

```json
{ "found": true, "fetchedAt": 1754...,  "activity": { ...raw Strava object } }
```

The strip cache is trimmed to 320 KB by **dropping the oldest** activities
(`trimActivitiesForCache`), so a miss is expected for older runs and means "not
in this runner's cached snapshot" — *not* "this activity does not exist". The UI
must say that distinction out loud, because the alternative reading would make an
admin think a run was fabricated.

Returns `found: false` with a `reason` of `no-cache` | `not-in-snapshot` |
`not-strava`.

### Owner identity — on the existing roster GET

After the scan, dedupe `userId`s, chunked `Promise.all` of `AuthProfile.get`,
and attach a least-privilege summary:

```ts
owner?: {
  displayName?: string;
  picture?: string;
  lastProvider?: string;
  lockedOut?: boolean;
  jailed?: boolean;
}
```

Best-effort — a lookup miss leaves the row with its raw `userId` and no `owner`,
which is exactly today's behaviour. **No email.** The `AuthProfile` row carries
one; it does not cross the wire.

`lockedOut` / `jailed` are surfaced because a run from an already-sanctioned
account is the single strongest prior that the shape is worth looking at.

## UI

`HeatmapTable.tsx` is already 267 lines. Adding four features would push it past
500, so it splits along the seams the features actually have:

- `HeatmapTable.tsx` — data loading, summary bar, table shell, Regenerate
- `RunRow.tsx` — one row: shape cell, owner cell, signals, actions, Strava expander
- `ShapeThumb.tsx` — the SVG (~30 lines), plus click-to-enlarge
- `lib/heatmap-shape.ts` — the pure core, shared with the server

Style stays with the page's existing inline-style convention. The one thing
borrowed from run.human's `AdminConsole.tsx` is its **semantic colour chip**
idea — a fixed colour per source and per signal — because scanning 300 rows for
an anomaly is exactly what colour is for.

Every user-supplied value (file name, display name, Strava activity JSON) renders
as a JSX text node. Never `dangerouslySetInnerHTML`: the whole point of this
screen is that some of these values are hostile. The Strava payload renders
inside a `<pre>` as `JSON.stringify` output, which is text, not markup.

The `picture` URL is owner-controlled data going into an `<img src>`. It is
already normalized on write by `normalizePictureUrl`, and an `<img>` cannot
execute script, but the render falls back to a monogram when it is absent or
fails to load.

## Testing

`src/lib/heatmap-shape.test.ts` (new, pure — no AWS, no DOM):

- path normalization, aspect ratio preserved, decimation cap respected
- first and last point always survive decimation
- degenerate bbox renders a dot, does not divide by zero
- each signal fires on its trigger case
- **and does not fire on an ordinary Vegas run** — a heuristic that flags
  everything is worse than none

Extend `src/app/api/gpx/admin/heatmap/admin-heatmap.test.ts`:

- shapes endpoint returns 404 to a non-admin
- a single unreadable S3 object degrades to `failed[]`, not a 500
- roster attaches `owner` and **never** emits an email field
- Strava endpoint distinguishes `no-cache` / `not-in-snapshot` / `not-strava`

## What this does not change

- The artifact builder's selection (`lib/heatmap-build.ts`) is untouched. D-03
  (no owner opt-in gate) and D-14 (endpoint precision) are recorded decisions and
  are not reopened here.
- The published artifact stays non-attributable. Everything in this spec is on
  the **admin** side of that boundary — which is precisely why the roster exists.
- Hide/Delete semantics are unchanged, including the confirm copy.
