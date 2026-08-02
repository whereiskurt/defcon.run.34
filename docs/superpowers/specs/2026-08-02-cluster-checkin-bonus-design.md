# Cluster Check-in Bonus — Design

**Date:** 2026-08-02
**App:** `apps/run.human`
**Status:** Approved for implementation

## Problem

Runners who show up together should be rewarded together. Three concrete scenarios:

1. **Morning runs** — everyone checks in at the corral before each day's DEF CON run.
2. **Social events** — a crowd shows up at the Rebar and is told to check in.
3. **Ad-hoc groups** — runners head out together and all check in at a halfway point.

Today each of those is worth the same as a solo check-in: a check-in lights that runner's
con-day for the run streak and nothing more. There is no signal anywhere in the score that
thirty people stood in the same place at the same time.

## Scoring context (what we must not break)

`src/lib/scoring-engine.ts` derives a runner's whole score from their ledger:

```
score = runStreak + socialStreak + ctfStreak + flagPoints
```

Two invariants govern this area:

- **`lib/rescore.ts:rescoreUser` is the only writer of `RunUser` score fields**, enforced by
  a source-scanning test (`src/lib/__tests__/scoring-write-invariant.test.ts`).
- **Accomplishments carry no points.** A check-in accomplishment only lights a con-day for
  the streak table `[0, 25, 50, 100, 500]`. There is no per-accomplishment point value to
  inflate.

So a cluster bonus cannot be an accrual bolted onto check-in creation. It has to be a
**ledger the engine re-values**, like everything else.

## Design

### 1. `ClusterAward` — the ledger

One row per (runner, cluster the runner was in).

```
pk: userId
sk: anchorCheckInId          the runner's EARLIEST check-in in that cluster
gsi2: TYPE#CLUSTERAWARD / startAt

attrs: clusterId, day, size, points, centroidLat, centroidLng,
       startAt, endAt, awardedAt, demoTag?
```

Keying the row by the runner's **anchor check-in id** is what makes re-sweeping safe. If a
cluster grows from 6 people to 14, each early runner still anchors on the same check-in, so
the sweep upserts *the same row* with a larger `points` value. Nothing double-awards, and a
cluster that dissolves under a config change has its rows deleted rather than stranded.

The `gsi2` partition is `TYPE#CLUSTERAWARD` with `startAt` as the sort key, so the sweep can
reconcile a bounded time range with a key condition instead of a scan. This shares the
`gsi2pk-gsi2sk-index` with `CheckIn.byGlobalRecent` (partition `TYPE#CHECKIN`) — different
partition value, no collision.

### 2. Engine — a fifth term

```
score = runStreak + socialStreak + ctfStreak + flagPoints + clusterBonus
```

`computeUserScore` takes a new `clusterAwards: {points, awardedAt}[]` input and a
`clusterCap` number.

**The per-day cap is enforced in the engine, not at write time.** Awards are grouped by
con-local day, sorted by points descending, and only the top `clusterCap` count toward
`clusterBonus`. This matters for two reasons:

- Raising the cap in the admin UI re-values every runner on their next rescore, exactly like
  a CTF config retune already does. Nothing needs re-sweeping.
- The live sweep only ever sees one time window, so it *cannot* enforce a whole-day cap
  correctly at write time. The engine can, because it sees the runner's full ledger.

`rescoreUser` loads `ClusterAward.query.byUser({userId})`, reads `clusterCap` from the
cluster config (short-TTL cached), and writes `scoreBreakdown.clusterBonus`. It remains the
sole writer, so the write invariant holds unchanged.

### 3. `cluster-detect.ts` — the detector (pure)

```ts
detectClusters(points: ClusterPoint[], cfg: ClusterConfig): DetectedCluster[]
```

`ClusterPoint` is `{ userId, checkInId, lat, lng, t }`. No I/O, no entities, no DynamoDB —
unit-testable with hand-built fixtures.

1. Drop any point not on a con day (`isConDay(conLocalDate(t))`, reusing `con-days.ts`).
2. Sort by time. For each check-in as a **seed**, advance a forward pointer to collect every
   point within `windowMinutes` of it. A cluster therefore spans at most one window and the
   seed is always its earliest member. This makes candidate generation
   `O(n · window-occupancy)` rather than `O(n²)`.
3. Within that time slice, keep points within `radiusMeters` (haversine) of the seed. Then
   run **one refinement pass**: recompute the centroid of those points and re-filter around
   the centroid. Without this, a seed on the edge of a crowd clips half the group.
4. Collapse to distinct users, keeping each user's earliest check-in. `size` = distinct user
   count.
5. Keep candidates with `size >= minRunners`. Sort by `(size desc, startAt asc, seedId asc)`.
6. **Greedy claim:** walk the sorted candidates and accept one only if at least `minRunners`
   of its users are still unclaimed. The accepted cluster consists of exactly those unclaimed
   users, and `points` is recomputed from that final size. Claimed users are removed from the
   pool.

Sizes shift as users are claimed, so the initial sort is an approximation of true max-cover.
That is intentional — it is deterministic, it is one pass, and at event scale the difference
is immaterial.

`points` comes from the tier table: the highest tier whose `minRunners` threshold the cluster
meets. Every member of a cluster receives the same award.

### 4. `cluster-sweep.ts` — reconcile (server-only)

```ts
sweepClusters({ since, until, dryRun }) → { clusters, written, deleted, rescored }
```

1. Page `CheckIn.byGlobalRecent` over the range with an **attribute projection** — the sweep
   needs `averageCoordinates`, `timestamp`, `userId`, `checkInId`, and must never pull the
   `samples` GPS blob.
2. `detectClusters(points, cfg)`.
3. Read existing `ClusterAward` rows in the same range via the `gsi2` key condition.
4. `diffAwards(desired, existing)` — a **pure** function returning `{ puts, deletes }`. Unit
   tested for upgrade, downgrade, delete-stale, and no-op.
5. Apply, then `rescoreUser` every affected runner, concurrency-limited (same shape as
   `/api/admin/rescore-all`).

`dryRun` computes everything through step 4 and returns it without applying. Preview is
therefore the same code path as the real sweep — what you see is what it will do.

### 5. Triggers

- **Live:** `app/api/checkins/route.ts` POST fires a fire-and-forget sweep bounded to
  `since = now - windowMinutes`. One key-condition query with a projection; skipped entirely
  when the config is disabled. Placed in the API route rather than in `createCheckIn` so
  `entities/` never imports `lib/rescore` (cycle risk).
- **Authoritative:** `POST /api/admin/clusters/sweep` over the whole con, with `dryRun`.

### 6. `ClusterConfig` — tunables

A single DDB row (`pk: CLUSTERCONFIG`), read through a 60s module cache, falling back to
defaults when absent. Persisting it means retuning the radius at the con needs no release.

```
enabled:           true
radiusMeters:      200
windowMinutes:     60
minRunners:        4
maxPerUserPerDay:  3
tiers:  [ {minRunners: 4,  points: 25},
          {minRunners: 8,  points: 50},
          {minRunners: 15, points: 100},
          {minRunners: 25, points: 200} ]
```

### 7. Admin UI — `/admin/clusters`

Admin-gated with the standard `requireAdmin` + `revalidateAdmin` → **bare 404**
non-disclosure contract used by every sibling admin surface. Denials never return 401/403.

- Config form (enabled toggle, radius, window, min runners, cap, editable tier table) →
  `PUT /api/admin/clusters/config`.
- **Preview (dry run)** → table of clusters: day, time, centroid with a map link, size,
  points each, total.
- **Sweep + award** → same table plus written/deleted/rescored counts.
- **Load demo clusters** / **Clear demo clusters** → seed and remove tagged test data
  (see below).

### 8. Runner-facing

`loadDrill` gains a `cluster` array; `RunnerDrill` renders a **Group check-ins** section
alongside Runs / Social / CTF. `YourStandingModal` reuses `RunnerDrill`, so the self-view
comes free.

```
Group check-ins                              450
  Wed 6:12 AM · 31 runners        +200
  Wed 9:40 PM · 12 runners         +50
  Thu 6:08 AM · 27 runners        +200
  Thu 2:22 PM ·  5 runners          —   (over daily cap)
```

run.human has no jsdom/RTL, so all logic lives in pure `src/lib/` modules and the React
components stay thin. No component-render tests.

## Demo data

Testing this before the con needs check-ins that (a) exist in numbers and (b) land on con
days. Since con days are 2026-08-05 through 2026-08-10 and today is 2026-08-02, demo
check-ins are deliberately **future-dated** onto con days — the detector only checks
`isConDay`, so this works, and the live sweep (`now - window`) never touches them.

Demo rows are marked two ways, and the clear path requires **both**:

- `userId` prefixed `democluster-`
- an explicit `demoTag: "cluster-demo"` attribute on every row

Deleting only rows carrying the tag avoids the prefix-matching hazard that has bitten this
repo before (a legitimate row whose key merely starts with the same characters).

Scenarios seeded: Wednesday morning corral (31), Wednesday Rebar social (12), Thursday
morning corral (27), Thursday halfway-point group (5), plus negative controls — two groups
250m apart that must not merge, a lone runner spamming eight check-ins, and a 3-runner group
under the threshold.

Available as `scripts/seed-cluster-scenarios.mts` (local or prod) and as admin UI buttons so
the data can be reloaded or cleared without a terminal.

## Testing

- `cluster-detect.test.ts` — Rebar meetup; morning corral trickling over 40 min; halfway
  group of 5; 200m GPS-drift spread; two groups 250m apart must not merge; one runner
  spamming eight check-ins must not cluster; 3-runner group under `minRunners`; non-con-day
  group excluded; greedy-claim determinism.
- `scoring-engine.test.ts` additions — `clusterBonus` sums; per-day cap keeps the best N by
  points; a cap change re-values.
- `cluster-sweep` — `diffAwards` upgrade / downgrade / delete-stale / no-op.
- The existing `scoring-write-invariant.test.ts` must stay green: cluster code writes
  `ClusterAward` rows, never `RunUser` score fields.

## Decisions

- Clusters are detected on **con days only**, matching every other scoring track.
- The daily cap counts a runner's **best** N clusters that day, not their first N.
- **Private check-ins count.** `isPrivate` defaults to `true`, so requiring public would make
  the feature almost never fire. Membership lists stay admin-only; public surfaces show only
  size and centroid.
- Every member of a cluster receives the **same** award — no proximity or arrival-order
  weighting.

## Abuse gates (added 2026-08-02, after review)

Both gates only ever remove a check-in from **clustering**. The row still saves
and still lights the runner's con-day for their run streak, so a false positive
costs one group bonus and is recovered on the next sweep. Neither is destructive.

### 1. Anti-sybil — `minAccountAgeHours` (default 24)

Clustering counts distinct *accounts*, not distinct *humans*, so four throwaway
accounts on one phone can manufacture a cluster. Because the tiers are
super-linear and the cap allows 3 awards/day across 6 con days, a ring of 25
accounts nets 3,600 points each — more than all three streak tracks combined
(1,500). That made the cluster bonus the most attractive thing on the board to
attack.

A runner counts toward a cluster if **any** of: the account is older than the
threshold, they have a run or Strava import, or they have solved a flag. A
permissive OR — a real attendee hits one; a throwaway created minutes ago hits
none. Check-ins are deliberately **not** an establishing signal, or the gate
would be circular.

Every signal is denormalized onto the RunUser row (`createdAt`,
`activityCounts`, `ctfSolves`), so the whole set is **one batch get per 100
runners** — no per-runner queries. Deliberately not gated on owning a bib: that
would make the bonus a bib-holder perk and exclude most social attendees, and
`Bib` is keyed by `ownerSub` (the OIDC sub), which is the id-namespace mismatch
that silently joins to null.

**Fail closed:** a runner whose row cannot be read is absent from the set and
does not count. A read failure must not become a bypass.

### 2. Impossible travel — `maxSpeedKmh` (default 21)

Within one runner's own timeline, if the implied speed from their previous
*surviving* check-in exceeds the threshold, the later one is ignored for
clustering. Chaining off the last surviving point (not the raw previous one)
stops a single bad GPS fix invalidating every genuine check-in after it.

The default is a fast running pace, because clusters are gatherings of runners.
This does also catch a runner who **drove** between two check-ins made close
together — hence the knob, tunable live from `/admin/clusters` toward ~50 if
honest runners get caught.

**This is a tripwire, not a wall.** It catches one account used in two places at
once, and scripted map-hopping. A patient spoofer who only ever reports one fake
location produces no contradiction and passes cleanly. The anti-sybil gate does
most of the real work.

### Not gated

- **Griefing by deletion.** A cluster sitting exactly at `minRunners` dissolves
  if one member deletes their check-in, removing the others' awards. Low yield,
  and every fix conflicts with the recompute model.
- **Proximity without participation.** At 200 m someone in the lobby scores like
  someone who ran. Inherent to check-in scoring; tightening trades against GPS
  drift.
- **The map layer.** The gates are scoring defences. The map shows what happened
  and is already a different view (public check-ins only), so it stays ungated.

## Out of scope

- Named venues / geofences. The detector finds crowds wherever they are; naming them adds
  config surface for no scoring benefit.
- Live "you got a group bonus!" toast on check-in. The sweep is retroactive, so an early
  arrival's toast would be wrong and then silently upgraded. The drill-in section is honest.
- Backfilling clusters from DC33 data.
