# DC34 Leaderboard + Activity Table — Design Spec

**Date:** 2026-07-13
**Status:** Approved design, ready to plan
**Scope:** Mostly `apps/run.human`, with one cross-service seam into `apps/run.gpx`
**Delivery:** GSD wave (4 phases)
**Related:** `hiddenctfsub/docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`
(the CTF judge — a **separate** worktree that owns CTF scoring; this board consumes its signal, see §6.3 + §11)

## 1. Goal

Bring back the DEF CON 33 leaderboard — which doubled as each runner's personal
activity table — into DEF CON 34's `run.human` service. A signed-in runner (for
now, an admin) sees a ranked accordion of all runners; expanding a row reveals
that runner's DEF CON runs, each with a small map thumbnail rendered from the
run's GPX track. The current build ships **hidden behind the admin group** so it
can be perfected before launch.

## 2. Background

### What DC33 did (the design we're porting)

Reference app: `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src`.

- **The leaderboard IS the activity table.** `components/leaderboard/LeaderboardTable.tsx`
  is a HeroUI `Accordion` (not an HTML `<table>`); each `AccordionItem` is one
  runner showing global rank, a `totalPoints` 🥕 chip, display name, and colored
  count chips (`activity`/`social`/`meshctf`). Expanding a row lazy-loads that
  runner's accomplishments; the current user's row is green-highlighted, so "my
  runs" and "the leaderboard" are literally the same component.
- **Thumbnails are client-side canvas, not stored images.**
  `components/routes/PolylineRenderer.tsx` draws into an HTML `<canvas>`: it
  decodes a polyline, computes bounds/zoom, fetches **one** OpenStreetMap raster
  tile as the basemap, then strokes the route with a white halo + colored line
  and green-start / red-end circle markers (dark-mode applies a canvas filter).
  No S3 thumbnail pipeline, no Mapbox static image, no server rendering.
- **Scoring** lives in an `Accomplishments` ElectroDB entity
  (`db/accomplishment.ts`); points on `metadata.points` are summed into
  denormalized `User.totalPoints` (`db/user.ts` `UpdateUserAccomplishmentCounts`).
  Rank order: `totalPoints` desc → accomplishment count desc → most-recent
  accomplishment desc → account `createdAt` asc.
- **Leaderboard API** (`app/api/leaderboard/route.ts`) scans users, computes
  `globalRank`, and caches for 60s with stale-while-revalidate. Per-row
  accomplishments load from `app/api/leaderboard/[userId]/accomplishments`.

### What's different in DC34

- **No leaderboard, no scoring, no accomplishments entity exists yet.** Activity
  today is `CheckIn` records (private by default) plus GPX uploads.
- **GPX lives in a separate service.** `run.gpx` owns its own DynamoDB table
  (`run-gpx-electro`, entity `GpxFile`) and its own S3 bucket
  (`uploads-dc34-run-gpx-<region>-<suffix>`, keys `uploads/{userId}/gpx/{fileId}.gpx`).
  `GpxFile` stores `bounds`, `totalDistance`, `totalElevation` — but **no
  polyline geometry and no thumbnail**. run.human has no live GPX read path.
- **Identity namespaces differ across services** (see the landmine in §7).

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Scoring model | Port DC33: points per activity summed into denormalized `RunUser` totals; new `Accomplishment` entity as source of truth. |
| Thumbnails | Client-side `<canvas>` from a **stored decimated polyline** (DC33 `PolylineRenderer` port). No S3/Lambda/Mapbox-static pipeline. |
| Visibility | **Admin-group gated** via `requireAdmin` → `notFound()`. Not added to any menu/nav. |
| Privacy on the page | **None for now** — everything on the leaderboard page is shown, because only admins can reach it. Privacy filtering is a launch-time concern (§9). |
| GPX → leaderboard sync | `run.gpx` notifies `run.human` via a secret-gated internal API call on GPX activation. |
| CTF integration | **Read-only.** The separate CTF judge worktree owns CTF scoring; this board consumes `RunUser.ctfScore` / `ctfSolves` and rolls them into the global score. No CTF write into `Accomplishment` (respects the CTF design's §11 boundary). |
| Global score | `activityScore` (this board's rollup: check-ins + GPX) **+** `ctfScore` (CTF judge's rollup), summed at read time. Reads `0` for CTF until that judge ships. |
| Point values | Tunable constants; defaults **1 pt / check-in, 1 pt / GPX upload**. CTF points are owned entirely by the CTF judge. |
| Profile rank widget | **Deferred to launch** (would leak the feature on the all-users profile page). |

## 4. Architecture overview

```
                    run.human (run-human-electro)
  ┌───────────────────────────────────────────────────────────────┐
  │  Accomplishment  (NEW — this board owns: check-ins + GPX only)  │
  │  RunUser  (+ activityScore/counts  ⟂  ctfScore/ctfSolves*)      │
  │                                     *written by the CTF judge   │
  │                                                                 │
  │  createCheckIn() ──► createAccomplishment(source=checkin)       │
  │  POST /api/internal/accomplishment ◄── (from run.gpx)           │
  │                                                                 │
  │  GET /api/leaderboard   (scan RunUser; score = activityScore    │
  │                          + ctfScore; rank by the sum)           │
  │  GET /api/leaderboard/[id]/accomplishments                     │
  │  (protected)/leaderboard/page.tsx   [requireAdmin → notFound]  │
  │     └─ LeaderboardTable.tsx ─ PolylineRenderer.tsx (canvas)     │
  └───────────────────────────────────────────────────────────────┘
        ▲ internal call (AUTH_INTERNAL_SECRET)      ▲ read-only signal
        │ carries OIDC sub                          │ (RunUser.ctfScore,
  ┌─────┴───────────────────────────────┐   ┌───────┴─────────────────┐
  │  run.gpx: on GPX activation          │   │  CTF judge (separate    │
  │   - decimate polyline from track     │   │  worktree) writes        │
  │   - store polyline on GpxFile        │   │  RunUser.ctfScore +      │
  │   - POST accomplishment → run.human  │   │  CtfSolve rows. Owns CTF │
  └──────────────────────────────────────┘   │  scoring end-to-end.     │
                                              └──────────────────────────┘
```

## 5. Data layer (run.human, `run-human-electro`)

### 5.1 New entity: `Accomplishment`

File: `apps/run.human/webapp/src/entities/accomplishment.ts`
(mirrors DC33 `db/accomplishment.ts`, adapted to the shared `electroClient` /
`ELECTRO_TABLE` in `entities/client.ts`).

Attributes:

- `userId` (RunUser adapter id — see §7 identity note), `accomplishmentId`
- `type`: `"activity"` (v1 only writes activity; the enum is kept open for
  future in-house types, but CTF/social are **not** modeled here — they live in
  the CTF judge's `CtfSolve` and are summed via `RunUser.ctfScore`, §6.3)
- `source`: `"checkin" | "gpx" | "strava"` (CTF/QR are **not** an accomplishment
  source — see the integration boundary in §11)
- `name`, `description`
- `completedAt` (epoch ms), `year` (DEF CON year, e.g. `2026`)
- `isPrivate` (boolean; carried from the source check-in — recorded but not used
  for filtering while admin-only, see §9)
- `metadata` map: `points`, **`polyline`** (decimated `[lat,lng][]` for the
  thumbnail), `distance`, `elevation`, `gpxFileId`, `checkInId`,
  `stravaActivityId`, `flagId`, `url`
- `createdAt`, `updatedAt`

Indexes (DC33 parity):

- `primary`: pk=`userId`, sk=`accomplishmentId`
- `byType` (`gsi1pk-gsi1sk-index`): pk=`[userId, type]`, sk=`completedAt`
- `byYear` (`gsi2pk-gsi2sk-index`): pk=`[userId, year]`, sk=`completedAt`

Helpers:
`createAccomplishment(...)` (writes the row **and** atomically bumps RunUser
totals), `getAccomplishmentsByUser(userId)`, `deleteAccomplishment(...)`
(decrements totals), plus a `checkDuplicate` guard keyed on `source`+external id
(`stravaActivityId` / `gpxFileId` / `checkInId`) so re-notifies are idempotent.

### 5.2 Extend `RunUser` (denormalized totals)

File: `apps/run.human/webapp/src/entities/run-user.ts`

Add attributes owned by **this board** (all default-zero / empty so existing rows
read cleanly):

- `activityScore` (number, default 0) — rollup of the points on this board's own
  accomplishments (check-ins + GPX). Deliberately named `activityScore`, **not**
  `totalPoints`, because the displayed global total is `activityScore + ctfScore`
  (§5.3) and must not be confused with the CTF-owned rollup.
- `activityCounts` map `{ checkin, gpx }` (default 0s) — count chips.
- `latestActivityAt` (number, optional).

Add `updateRunUserActivityCounts(userId, { source, pointsDelta, completedAt })`
mirroring DC33 `UpdateUserAccomplishmentCounts`: `add`/`subtract` on the source
count and `activityScore` (floored at 0), set `latestActivityAt`. Called only
from `createAccomplishment` / `deleteAccomplishment` so totals never drift.

**Coordination note (same-entity, two worktrees):** the CTF judge worktree
independently adds `ctfScore` + `ctfSolves` to this **same** `RunUser` entity.
The additions are non-conflicting (different attributes), but the two branches
both edit `entities/run-user.ts` — merge them additively; neither owns the
other's fields.

### 5.3 Scoring constants

File: `apps/run.human/webapp/src/lib/leaderboard-scoring.ts`

```
POINTS = { checkin: 1, gpx: 1, strava: 1 }   // CTF points owned by the CTF judge

// Global score summed at read time from two independent rollups:
globalScore(runUser) = runUser.activityScore + (runUser.ctfScore ?? 0)
```

Single source of truth for point values and the rank comparator
(`globalScore` desc → total count [`activityCounts` sum + `ctfSolves`] desc →
`latestActivityAt` desc → `createdAt` asc). Pure + unit-tested. `ctfScore` /
`ctfSolves` are read straight off the same scanned `RunUser` row (default `0`),
so the board ranks correctly whether or not the CTF judge has shipped.

## 6. Where accomplishments come from

### 6.1 Check-ins (in-service)

`apps/run.human/webapp/src/entities/checkin.ts` `createCheckIn()` already writes
the CheckIn row and bumps `RunUser.checkInCount`. Extend it to also call
`createAccomplishment({ source: "checkin", type: "activity", points: POINTS.checkin,
isPrivate, checkInId, completedAt })`. `deleteCheckIn()` gains the matching
`deleteAccomplishment`.

### 6.2 GPX (cross-service seam)

- **run.gpx side** — in the activation path
  (`apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts`, where a
  file flips to `status: "active"`):
  1. Parse the track (the file is already fetched/validated here for bounds).
  2. **Decimate** to ~100 points (reuse the haversine/track-walk logic already in
     `apps/run.gpx/webapp/scripts/seed-local-routes.ts`); store the result on a
     new `GpxFile.polyline` attribute (also useful to gpx-studio later).
  3. `POST` to run.human `/api/internal/accomplishment` with
     `{ oidcSub, source: "gpx", gpxFileId, name (fileName), distance, elevation,
     polyline, completedAt }`, signed with `AUTH_INTERNAL_SECRET`.
  Failure is non-fatal to the upload (log + continue) — the leaderboard is
  best-effort, never blocks a save.
- **run.human side** — new route
  `apps/run.human/webapp/src/app/api/internal/accomplishment/route.ts`, following
  the existing secret-gated internal-route pattern (cf. the internal
  `PATCH /api/internal/user/[oidcSub]`). It validates the shared secret,
  resolves `oidcSub → RunUser.userId` (§7), and calls `createAccomplishment(...)`
  with `type: "activity"`, `points: POINTS.gpx`, idempotent on `gpxFileId`.

Alternatives considered (documented, not chosen): a DynamoDB stream on `GpxFile`
→ Lambda → run.human (more decoupled, new infra); or run.human scanning
`run-gpx-electro` directly (couples run.human to another service's table + IAM).
The internal call is the simplest path that keeps run.human the sole owner of
the leaderboard and adds no AWS infra.

### 6.3 CTF (read-only consumption — NOT an accomplishment source)

The CTF judge is a **separate worktree** that owns CTF scoring end-to-end
(`2026-07-13-ctf-judge-and-covert-channel-design.md`). Per its §11 integration
boundary, it exposes a signal and this board **consumes** it — it does **not**
write into `Accomplishment`, and this board does **not** call into the judge:

- **Rollup (v1):** the judge maintains `RunUser.ctfScore` and `RunUser.ctfSolves`
  on the same `run-human-electro` `RunUser` row this board already scans. The
  leaderboard reads them directly (`globalScore = activityScore + ctfScore`; a
  CTF count chip from `ctfSolves`). No new query, no coupling, `0` until they
  ship. This is the whole v1 integration.
- **Per-solve drill-in (future, not v1):** the judge's `CtfSolve` rows are the
  auditable source of truth, queryable per user via its `gsi1`
  (`$run#user_<authUserId>`). Listing individual CTF solves inside a runner's
  expanded row is a nice-to-have that requires resolving `RunUser.userId →
  authUserId` (§7 bridge) and reading their entity — deferred to keep v1
  decoupled from an unbuilt schema (§13).

## 7. Identity resolution (LANDMINE)

Cross-service joins by the wrong id silently return null (see memory
`reference_auth_id_namespace_mismatch`). Rules for this feature:

- `Accomplishment.userId` = `RunUser.userId` = the Auth.js **adapter uuid** =
  `session.user.id`. Check-ins are already keyed this way, so the in-service hook
  is a direct match.
- The **GPX internal call carries the raw OIDC `sub`**, because `run.gpx` keys by
  its own session id and must not assume it equals run.human's adapter uuid. The
  run.human internal route resolves `sub → adapter userId` via the `authjs`
  accounts table (the same bridge used by `entities/bib.ts` `getRunnerCode` /
  `entities/auth-user.ts` `scanAccountSubs`). If no run.human RunUser exists for
  that sub yet, the accomplishment is dropped (logged) — a runner must have a
  run.human identity to appear on the board.

## 8. Leaderboard API + UI

### 8.1 API

- `GET /api/leaderboard?page&limit&filter`
  — `scanAllRunUsers()`, compute `globalScore = activityScore + (ctfScore ?? 0)`
  per row, sort by the §5.3 comparator, assign `globalRank` over the **full**
  sorted list (filter narrows display, not rank), paginate. 60s in-memory cache +
  stale-while-revalidate (DC33 parity). **Admin-gated** (`requireAdmin` → 404 on
  deny). Count chips: activity (`activityCounts`) + CTF (`ctfSolves`).
- `GET /api/leaderboard/[userId]/accomplishments`
  — `getAccomplishmentsByUser`, returns `{type,name,description,completedAt,year,metadata}`.
  Admin-gated. **No privacy filter now** (admin-only surface); the filter hook is
  where §9 will slot in at launch.

### 8.2 UI (near-verbatim DC33 ports, re-pointed at DC34 entities)

- `apps/run.human/webapp/src/components/leaderboard/PolylineRenderer.tsx`
  — canvas + single OSM tile + route + start/end dots + dark-mode filter. Ports
  almost as-is from DC33.
- `apps/run.human/webapp/src/components/leaderboard/LeaderboardTable.tsx`
  — HeroUI `Accordion`; rank / `globalScore` 🥕 / name / count chips;
  current-user green highlight; search + fast-filter chips; pagination; expand →
  runs with `PolylineRenderer`. Runner-class emoji/classes adapted to DC34
  `RunUser.mqttUsertype` (`rabbit`/`admin`/`wildhare`/`og`).
- `apps/run.human/webapp/src/app/(protected)/leaderboard/page.tsx`
  — server component: `const g = requireAdmin(session); if (!g.ok) notFound();`
  then `await revalidateAdmin(session.user.id)` per the /admin entry contract.
  Renders `<LeaderboardTable/>`. **Not linked from any nav.**

## 9. Privacy — deferred to launch (out of scope now)

Because the page is admin-only, everything is shown. When the board later opens
to non-admins, the following must be handled (recorded here so it isn't lost):
aggregate points/counts stay public; a runner's own row shows all their runs;
other runners' `isPrivate` check-ins are hidden; GPX runs appear only if
share-eligible. `Accomplishment.isPrivate` is already persisted for that day. The
launch change is: relax the gate from admin-only to signed-in, apply the privacy
filter in the accomplishments route, add the nav link + profile rank widget.

## 10. File plan

**New (run.human):**
- `entities/accomplishment.ts`
- `lib/leaderboard-scoring.ts`
- `lib/leaderboard-data.ts` (scan + rank + cache; testable core)
- `app/api/leaderboard/route.ts`
- `app/api/leaderboard/[userId]/accomplishments/route.ts`
- `app/api/internal/accomplishment/route.ts`
- `app/(protected)/leaderboard/page.tsx`
- `components/leaderboard/LeaderboardTable.tsx`
- `components/leaderboard/PolylineRenderer.tsx`
- tests: `leaderboard-scoring.test.ts`, `leaderboard-data.test.ts`,
  polyline-decode test

**Modified (run.human):**
- `entities/run-user.ts` (`activityScore`/counts + `updateRunUserActivityCounts`)
- `entities/checkin.ts` (`createCheckIn`/`deleteCheckIn` hooks)

**Modified (run.gpx):**
- `entities/gpx-file.ts` (add `polyline` attribute)
- `app/api/gpx/files/[id]/confirm/route.ts` (decimate + notify)
- `lib/` helper for polyline decimation (extracted from seed script)

## 11. GSD wave — milestone v2.2, phases 49–52

> Phase numbering: the CTF judge worktree (`hiddenctfsub`) owns milestone **v2.1,
> phases 44–48**. This leaderboard wave is milestone **v2.2, phases 49–52** — the
> next free block above CTF. (Both add fields to the shared `RunUser` entity; see
> §5.2 merge note.)

- **Phase 49 — Data layer (run.human only):** `Accomplishment` entity, RunUser
  `activityScore`/counts, scoring constants (incl. the `+ ctfScore` read-time
  sum), check-in hook, tests. The board accrues score data even before any UI
  exists.
- **Phase 50 — GPX integration:** `GpxFile.polyline`, decimation helper, run.gpx
  notify on activation, run.human internal accomplishment route + identity
  bridge, tests.
- **Phase 51 — Leaderboard API:** scan/rank/cache core + both admin-gated routes,
  tests.
- **Phase 52 — UI:** `PolylineRenderer` + `LeaderboardTable` + admin-gated page.
  Verify signed-in as admin.

## 12. Point-value defaults (tunable)

`checkin: 1`, `gpx: 1`, `strava: 1`, `ctf/qr: flag-defined`. Centralized in
`lib/leaderboard-scoring.ts`; change one constant to retune the whole board.

## 13. Out of scope / future

- Public launch: gate relaxation, privacy filter, nav link, profile rank widget.
- Server-rendered PNG thumbnails to S3 (rejected in favor of the DC33
  client-canvas port; the `s3-uploads-processor` module remains the hook if ever
  wanted).
- **CTF per-solve drill-in** — listing individual `CtfSolve` rows inside a
  runner's expanded row (v1 only rolls up `ctfScore`/`ctfSolves`; see §6.3).
- Strava re-integration (the `strava` source is reserved but no sync is built).
- Backfill of pre-existing check-ins/GPX into accomplishments — trivial at this
  point since the event has not occurred; an optional one-off script if desired.

## 15. CTF integration boundary (mirror of the CTF design's §11)

- The CTF judge **owns** CTF scoring, validation, `CtfSolve`, and the CTF-only
  admin board at `q.defcon.run/admin/leaderboard`.
- This board **owns** the global/total leaderboard and the `Accomplishment`
  model (check-ins + GPX).
- The **only** coupling is read-only: this board reads `RunUser.ctfScore` /
  `ctfSolves` (both rollups on the shared `RunUser` row) and sums CTF into the
  global score. Neither side writes the other's fields; the shared edit to
  `entities/run-user.ts` is additive and must be merged, not owned (see §5.2).

## 14. Testing / verification

- Unit: scoring comparator, RunUser totals math, polyline decode/decimate,
  idempotent re-notify.
- Integration (local, per `reference_local_auth_e2e_testing`): create a check-in
  → accomplishment appears + totals bump; simulate a GPX notify → accomplishment
  appears once (idempotent on repeat); leaderboard route ranks correctly;
  non-admin gets 404, admin sees the board.
```
