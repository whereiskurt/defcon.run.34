# Phase 49: Leaderboard Data Layer — Accomplishment Entity + Scoring - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** Design spec (`docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md`) — brainstormed + approved with KPH

<domain>
## Phase Boundary

**This phase (49) is run.human-only, data layer only.** It builds the scoring
substrate the rest of the v2.2 wave sits on:

- A new `Accomplishment` ElectroDB entity on the shared `run-human-electro` table
  (`entities/client.ts` `electroClient` / `ELECTRO_TABLE`), owning the runs this
  board scores: **check-ins + GPX** (Strava reserved). It is a DC33 port of
  `db/accomplishment.ts` adapted to DC34 entities.
- Denormalized rollups on the existing `RunUser` entity so the leaderboard is a
  cheap scan (no accomplishment-wide scan needed).
- A pure, unit-tested scoring module (constants + comparator + the read-time
  `globalScore = activityScore + ctfScore` sum).
- Wiring the existing check-in write path (`createCheckIn`/`deleteCheckIn`) to
  create/delete the matching accomplishment.

**NOT in this phase** (later phases of v2.2): GPX polyline extraction + the
internal accomplishment endpoint (Phase 50); the leaderboard read API + caching
(Phase 51); any UI, `PolylineRenderer`, or the hidden admin page (Phase 52).

**NOT in this milestone at all:** CTF scoring — owned entirely by the separate
CTF judge worktree (`hiddenctfsub`, v2.1 / phases 44-48). This phase only
*reads* the CTF rollup; it never writes it.
</domain>

<decisions>
## Implementation Decisions (LOCKED — from the approved spec)

### Accomplishment entity (LDBR-01)
- File `apps/run.human/webapp/src/entities/accomplishment.ts`, using the shared
  `electroClient` + `ELECTRO_TABLE` from `entities/client.ts`.
- Keys: `pk = userId` (the run.human Auth.js **adapter uuid** = `session.user.id`
  = `RunUser.userId`), `sk = accomplishmentId`.
- Attributes: `userId`, `accomplishmentId`, `type` (`"activity"` — v1 only writes
  activity), `source` (`"checkin" | "gpx" | "strava"` — **NOT** `ctf`/`qr`),
  `name`, `description`, `completedAt` (epoch ms), `year` (e.g. 2026),
  `isPrivate` (boolean, carried from the source check-in; persisted but not used
  for filtering while the board is admin-only), `metadata` map
  (`points`, `polyline`, `distance`, `elevation`, `gpxFileId`, `checkInId`,
  `stravaActivityId`), `createdAt`, `updatedAt`.
- GSIs (DC33 parity): `byType` (`gsi1pk-gsi1sk-index`, pk=`[userId,type]`,
  sk=`completedAt`), `byYear` (`gsi2pk-gsi2sk-index`, pk=`[userId,year]`,
  sk=`completedAt`).
- Helpers: `createAccomplishment(...)` (writes the row AND atomically bumps the
  RunUser rollup via the §LDBR-02 helper), `getAccomplishmentsByUser(userId)`,
  `deleteAccomplishment(...)` (decrements the rollup), and a duplicate-guard keyed
  on `source` + external id (`checkInId` / `gpxFileId` / `stravaActivityId`) so
  re-creates are idempotent. Export `AccomplishmentItem` type.

### RunUser rollups (LDBR-02)
- Extend `apps/run.human/webapp/src/entities/run-user.ts` with **default-zero /
  optional** attributes so existing rows read cleanly:
  `activityScore` (number, default 0), `activityCounts` map `{checkin, gpx}`
  (default 0s), `latestActivityAt` (number, optional).
- Deliberately named `activityScore`, **not** `totalPoints`, because the displayed
  total is `activityScore + ctfScore` and must not be confused with the CTF rollup.
- Add `updateRunUserActivityCounts(userId, {source, pointsDelta, completedAt})`:
  atomic `add`/`subtract` on the source count + `activityScore` (floored at 0),
  set `latestActivityAt`. Called ONLY from `createAccomplishment` /
  `deleteAccomplishment` so totals never drift.
- **Coordination:** the CTF judge worktree independently adds `ctfScore` +
  `ctfSolves` to this SAME entity. Additions are non-conflicting (different
  attributes); the `entities/run-user.ts` edit is an additive merge — neither
  side owns the other's fields.

### Scoring module (LDBR-03)
- File `apps/run.human/webapp/src/lib/leaderboard-scoring.ts`, pure + unit-tested.
- `POINTS = { checkin: 1, gpx: 1, strava: 1 }` (tunable constants — single source
  of truth for point values). CTF points are owned by the CTF judge, not here.
- `globalScore(runUser) = runUser.activityScore + (runUser.ctfScore ?? 0)`.
- Rank comparator: `globalScore` desc → total count (`activityCounts` sum +
  `ctfSolves`) desc → `latestActivityAt` desc → `createdAt` asc (DC33 order).

### Check-in hook (LDBR-04)
- `createCheckIn()` in `entities/checkin.ts` already writes the CheckIn row and
  bumps `RunUser.checkInCount`. Extend it to also
  `createAccomplishment({ source: "checkin", type: "activity",
  points: POINTS.checkin, isPrivate, checkInId, completedAt })`.
- `deleteCheckIn()` gains the matching `deleteAccomplishment` (idempotent).

### CTF read-only boundary (LDBR-12)
- Scoring reads `RunUser.ctfScore` / `ctfSolves` off the same scanned row
  (default 0 until the CTF judge ships). This phase writes NO CTF data and calls
  nothing in the CTF judge. Respects the CTF design's §11 integration boundary.

### Claude's Discretion
- Exact ElectroDB attribute typing/watch config, `accomplishmentId` minting
  (uuid vs deterministic), and the precise duplicate-guard query shape — follow
  the existing `entities/checkin.ts` / `entities/user-upload.ts` conventions.
- Test file layout and fixtures — mirror `admin-report.test.ts` conventions.
- Whether `updateRunUserActivityCounts` lives in `run-user.ts` or is called from
  `accomplishment.ts` — keep the "only via create/delete" invariant either way.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (authoritative)
- `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md` — the
  full approved design. Phase 49 implements §5 (Data layer: 5.1 Accomplishment,
  5.2 RunUser rollups, 5.3 Scoring), §6.1 (check-in hook), §6.3 + §11/§15 (CTF
  read-only boundary), §7 (identity namespace note).

### DC33 source to port (read-only reference, different repo)
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/db/accomplishment.ts`
  — the entity + `createAccomplishment` + count-bump this phase ports.
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/db/user.ts` —
  `UpdateUserAccomplishmentCounts` + the leaderboard sort order to mirror.

### DC34 patterns to follow (this repo)
- `apps/run.human/webapp/src/entities/client.ts` — shared `electroClient` +
  `ELECTRO_TABLE`.
- `apps/run.human/webapp/src/entities/checkin.ts` — `createCheckIn`/`deleteCheckIn`
  (the hook site) + the `pk=userId sk=[timestamp,checkInId]` + GSI conventions.
- `apps/run.human/webapp/src/entities/run-user.ts` — the entity to extend
  (`scanAllRunUsers`, atomic `add` patterns, `RunUserItem`).
- `apps/run.human/webapp/src/lib/admin-report.ts` + `admin-report.test.ts` —
  aggregation + pure-helper + unit-test conventions to mirror.

### CTF integration boundary (separate worktree, read-only)
- `../hiddenctfsub/docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`
  §3.3 (`RunUser.ctfScore`/`ctfSolves`) + §11 (integration boundary — they expose
  the signal, we consume it, no cross-writes).
</canonical_refs>

<specifics>
## Specific Ideas

- The whole point of the denormalized `activityScore` on `RunUser` is that Phase
  51's leaderboard is a `scanAllRunUsers()` sorted by `globalScore` — never an
  accomplishment-table scan. Keep the rollup authoritative and drift-free.
- `isPrivate` is persisted now even though it is unused while admin-only, so the
  launch-time privacy filter (spec §9) has the data it needs without a backfill.
- Ship this phase's write hooks even though no UI exists yet — the board
  accrues real score data quietly so it is pre-populated when the hidden page is
  eventually revealed.
</specifics>

<deferred>
## Deferred Ideas

- GPX polyline extraction + internal accomplishment endpoint → Phase 50.
- Leaderboard scan/rank/cache API + admin-gated routes → Phase 51.
- UI (`PolylineRenderer`, `LeaderboardTable`, hidden admin page) → Phase 52.
- Launch privacy filter, nav link, profile rank widget → post-v2.2 launch flip
  (spec §9, §13).
- CTF per-solve drill-in (listing `CtfSolve` rows in the expanded row) → future
  (spec §13); v1 only rolls up `ctfScore`/`ctfSolves`.
- Backfill of pre-existing check-ins/GPX into accomplishments → optional one-off
  (spec §13); trivial pre-event.
</deferred>

---

*Phase: 49-leaderboard-data-layer-accomplishment-entity-scoring*
*Context gathered: 2026-07-14 from approved design spec*
