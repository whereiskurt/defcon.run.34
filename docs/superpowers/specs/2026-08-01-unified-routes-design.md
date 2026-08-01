# Unified Routes — one noun, one Share control

**Date:** 2026-08-01
**App:** run.gpx (`apps/run.gpx`)
**Supersedes the user-facing half of:** `2026-07-28-routes-vs-runs-design.md` (the
entity split it introduced is kept; only the vocabulary and the sharing UI change).

## Problem

The word "route" means three unrelated things, and there are four different ways to
share, all labelled some variant of "Share".

Three meanings of "route":

1. `File → New route` (⌘+) — `createFile()` drops an empty buffer in the editor that
   you draw into. Auto-save later persists it as a `GpxFile`.
2. `Add run → Create a route` — a card form plus a GPX upload that mints a `Route`
   row, a different entity entirely.
3. The publishable thing in the Community Routes map layer.

Four ways to share:

| Mechanism | Storage | UI label |
|---|---|---|
| `Route.publish` / `unpublish` | `Route.visibility` | Share / Unshare |
| Token share link | `GpxShare` row, public or email-restricted | Share |
| "Submit to DEF CON run" | `GpxFile.shareRequested`, admin curates into a GLOBAL folder | Send icon |
| Anonymous aggregate blend | `GpxFile.includeInAggregate` | checkbox |

Plus `convert-public` (Strava compliance) and `routes/[id]/copy` ("Add to My Maps"),
which copies a `Route` back into a `GpxFile` — so an object can round-trip between the
two types and change identity on the way.

The result: a runner uploads a map, and whether they can share it — and what "share"
even does — depends on which of two entities happened to be created, via which of five
creation paths. That distinction is an implementation detail leaking into the UI.

## Goal

One noun. One list. One Share control with the same three states no matter what you are
looking at. The `GpxFile` / `Route` split survives underneath, invisibly.

## Non-goals

- Merging the two entities. `Route` has no `conDay` **field**, which is what makes it
  structurally impossible for a route to satisfy the leaderboard's scored-run predicate
  (`lib/gpx-reconcile.ts`). Merging would demote that schema guarantee to a runtime
  check on the scoring path. Not worth it.
- Changing con-day run logging. A run has a date, a daily quota and a score; it is a
  genuinely different intent and keeps its own entry point.
- Changing admin surfaces. `/admin/routes` moderation and `files/[id]/publish` into
  GLOBAL folders are untouched.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Unify vocabulary and UI; keep both entities | Preserves the unscoreable-by-schema guarantee; no migration |
| D2 | The noun is **route** | Matches the entity, the Community Routes layer, gpx.studio's own "New route", and the domain. "Map" is ambiguous with the basemap |
| D3 | Three share states: Private / Anyone with link / Public on the map | Covers every capability runners actually use; drops email-restricted as a user-facing mode |
| D4 | One list adopts orphan `Route` rows | No migration on live data; the orphan set only shrinks |
| D5 | Retire `shareRequested` from the UI; keep the aggregate opt-in; make `convert-public` automatic | Self-serve Public already does what the curation request was for; compliance stays enforced without the user knowing the word |
| D6 | Public routes auto-resync on save | "It's the same thing" only holds if editing the route updates what everyone sees |
| D7 | Ship as one phase, one release | User's call, made with the Aug 5–10 timing risk stated |
| D8 | Keep `Add run` as its own entry point, green and glowing | Con-day logging is the primary CTA during the event |

## Design

### Data model

`GpxFile` gains one optional attribute:

```ts
// Links this route to its published public face, if it has one. Schema-on-write:
// absent on every existing row, no migration, no backfill. Route.sourceGpxFileId
// points the other way, so the pair is bidirectional.
publishedRouteId: { type: "string", required: false },
```

Nothing else changes. `Route` keeps its exact schema — including having no `conDay`
attribute, which the existing schema test locks and which this design deliberately
does not touch.

Ownership of the two S3 objects is unchanged: `uploads/{userId}/…` for the file,
`uploads/ROUTES/{routeId}.gpx` for the published copy. The route key stays free of any
user identifier, because presigned URLs expose the key path.

### The Share control

Replaces `ShareDialog.svelte`'s current public/private-emails radio group.

```
Share ▾
  ○ Private            no Route, no token
  ○ Anyone with link   GpxShare token (URL shown inline, copyable, revocable)
  ● Public on the map  Route published → Community Routes layer
  ───────────────────────────────────────
  ☑ Also blend into the anonymous heat overlay
```

The three states are mutually exclusive. The checkbox is orthogonal — it is anonymity,
not sharing, and it maps to `includeInAggregate` unchanged.

The word **Unshare** is retired. You do not unshare; you set a route back to Private.

### Transitions

A single server endpoint performs every transition atomically:

```
PUT /api/gpx/files/[id]/visibility   { state: 'private' | 'link' | 'public' }
→ 200 { state, shareUrl?, routeId? }
```

It composes primitives that already exist and are already in production:

| From → To | Server does |
|---|---|
| → `public` | `POST /routes { fromFileId }` (mints Route, copies the S3 object) → `POST /routes/{id}/publish`; persist `publishedRouteId` |
| `public` → `private` | `POST /routes/{id}/unpublish`. The `Route` row is **kept**, so re-publishing is instant and `copyCount` survives |
| → `link` | `POST /shares` with `accessMode: 'public'`; return the token URL |
| `link` → `private` | revoke the `GpxShare` row |
| → `public` on a Strava import | runs `convert-public` first, silently, and publishes the converted copy |

The Strava case is the compliance linchpin and must not regress: a row with
`publicShareEligible: false` must never reach `visibility: 'published'`. The endpoint
enforces this server-side; it is not a UI convention.

Standard gates apply on every write, matching the endpoints being composed:
`session.user.id` required, `services` must include `gpxstudio`, and
`assertNotLockedLive(session.user.id)` at the write boundary.

### One list

`My Maps` becomes **My Routes** (`File → My Routes…`, ⌘O unchanged). It lists:

- every `GpxFile` the runner owns (as today), plus
- every `Route` the runner owns whose `sourceGpxFileId` is absent — the orphans left
  over from the old card form.

Both render as the identical row with the identical Share menu. For an orphan, Private
simply means unpublished; it never grows a `GpxFile` unless someone copies it. The merge
is done client-side from the two list calls that already exist — no new list endpoint.
`GET /api/gpx/routes` already returns the full `Route` item, so `sourceGpxFileId` is
present in the response today; only the client-side `RouteSummary` interface in
`cloud-sync.ts` omits the field and must declare it.

### Deleting

Deleting a route that is Public deletes its `Route` row and S3 object too — one object
in the UI, one delete. It disappears from the community map. Copies other runners
already made are untouched (they are independent `GpxFile` rows), which is the existing
`DELETE /routes/{id}` contract. Deleting an orphan `Route` is the same operation with no
`GpxFile` side.

Removed from the row: **Save as Route** (every row is already a route) and the
`shareRequested` "submitted to DEF CON run" badge.

### Staleness

When a route is Public, auto-save re-pushes content to the linked `Route` object in the
same debounced cycle that writes the user's own file, and PATCHes the derived metrics
(distance, bounds, counts). The community map reflects an edit within one auto-save
cycle. Unpublished routes do exactly what they do today — one write, no extra cost.

### Entry points

| Today | After |
|---|---|
| `File → New route` (⌘+) | unchanged — and now honest: this *is* how you make a route |
| `File → My Maps…` (⌘O) | `File → My Routes…` (⌘O) |
| `Add run → Create a route` | **removed** (the `routebuild` view leaves `QuickStartHub.svelte`) |
| `My Maps → Save as Route` | **removed** |
| `Add run → Log a run` | unchanged |

Community layer keeps the name Community Routes; its **Add to My Maps** action becomes
**Add to My Routes**.

### Buttons

`.add-run-glow` (green `#22c55e`, pulsing, with a reduced-motion fallback) exists in
`Menu.svelte` but is applied only to the desktop pill and the mobile FAB. It is applied
to the two remaining "Add run" surfaces that lack it: the `File ▾ → Add run…` menubar
item and the hub's **Log a run** card, which currently borrows `primary`. Same class,
no new CSS.

**From Strava** stops borrowing `primary` and takes Strava orange `#FC4C02` — the hub
button and the `StravaStrip` accent — so orange consistently means Strava and green
consistently means add-a-run.

## Files

| File | Change |
|---|---|
| `webapp/src/entities/gpx-file.ts` | `+publishedRouteId` |
| `webapp/src/app/api/gpx/files/[id]/visibility/route.ts` | new — the one transition endpoint |
| `gpx-studio/…/cloud/ShareDialog.svelte` | becomes the tri-state control |
| `gpx-studio/…/cloud/CloudStorage.svelte` | rename, one Share menu, adopt orphan Routes, drop *Save as Route* and the `shareRequested` badge |
| `gpx-studio/…/QuickStartHub.svelte` | delete the `routebuild` view (~150 lines) |
| `gpx-studio/…/Menu.svelte` | rename, green glow on both Add-run surfaces, orange Strava |
| `gpx-studio/…/lib/auto-save.ts` | resync the linked `Route` when the route is Public |
| `gpx-studio/…/lib/cloud-sync.ts` | `setShareState()`; `+sourceGpxFileId` on `RouteSummary`; existing route helpers stay for the community layer |
| `gpx-studio/…/map/community-routes.ts` | "Add to My Maps" → "Add to My Routes" |

Left in place deliberately: the `files/[id]/request-share` and
`admin/share-requests` endpoints and the admin page keep working; only the user-facing
flag comes out. `/admin/routes` moderation and `files/[id]/publish` are untouched.

`CloudStorage.svelte` is **legacy Svelte mode** — introducing `$state()` there flips it
to runes and breaks its `$:` lines. Use plain `let`.

## Verification

- **Existing** schema test locking "`Route` has no `conDay`" stays; it is the guard on
  the scoring path and must remain green.
- **Existing** `buildRouteCopyPayload` test (copy mints no `conDay`,
  no `stravaActivityId`) must remain green.
- Round-trip `private → public → private → public` preserves `copyCount` and reuses the
  same `routeId`.
- A `publicShareEligible: false` Strava import set to `public` produces a converted copy
  and never publishes the raw import.
- An orphan `Route` renders in My Routes and toggles Public/Private from the same menu.
- Deleting a Public route removes it from the community map and leaves other runners'
  existing copies intact.
- A published route edited in the editor shows the edit on the community map after one
  auto-save cycle.
- `e2e/cloud-storage.spec.ts` — dialog-name selectors updated for My Routes.

## Risks

- **Timing.** Con is Aug 5–10; this rewrites the live sharing path four days out. Raised
  with the user, who chose a single whole release over a two-slice ship (D7). The
  mitigation is that every transition composes an endpoint already running in
  production — the new code is orchestration, not new sharing machinery.
- **Auto-resync write volume.** Only published routes pay the extra PUT, and only on a
  debounced auto-save. If it proves noisy, the fallback is D6's runner-up: snapshot plus
  an explicit "Update" affordance on the row.
- **run.gpx deploys `us-east-1` only.** Release must pass `--regions use1`; the ECR
  probe otherwise errors open and targets every region.
