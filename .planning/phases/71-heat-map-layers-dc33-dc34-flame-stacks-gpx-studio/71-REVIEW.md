---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
reviewed: 2026-07-31T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - apps/run.gpx/webapp/src/lib/heatmap-artifact.ts
  - apps/run.gpx/webapp/src/lib/heatmap-artifact.test.ts
  - apps/run.gpx/webapp/src/lib/polyline-decode.ts
  - apps/run.gpx/webapp/src/lib/polyline-decode.test.ts
  - apps/run.gpx/webapp/src/lib/heatmap-build.ts
  - apps/run.gpx/webapp/src/lib/heatmap-build.test.ts
  - apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts
  - apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts
  - apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts
  - apps/run.gpx/webapp/src/entities/gpx-file.ts
  - apps/run.gpx/webapp/scripts/backfill-dc33-heatmap.ts
  - apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/HeatMap.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/stores/layer-section-collapse.ts
  - apps/run.gpx/gpx-studio/website/src/lib/stores/layer-visibility.ts
  - infra/terraform/modules/heatmap-scheduler/v1.0.0/main.tf
  - infra/terraform/modules/heatmap-scheduler/v1.0.0/iam.tf
  - infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf
  - infra/terraform/modules/heatmap-scheduler/v1.0.0/outputs.tf
  - infra/terraform/modules/heatmap-scheduler/v1.0.0/lambda/index.mjs
  - infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl
findings:
  critical: 3
  warning: 9
  info: 5
  total: 17
status: issues_found
---

# Phase 71: Code Review Report

**Reviewed:** 2026-07-31
**Depth:** standard (per-file, plus live production probes of the shipped surfaces)
**Files Reviewed:** 23
**Status:** issues_found

## Summary

The heat-map pipeline is carefully built and unusually well documented, and the two
things the phase was asked to get right structurally, it got right:

- `assertNonAttributable` is genuinely called on **every** write path. `grep` for
  `heatmapArtifactKey` / `PutObjectCommand` finds exactly two writers of
  `uploads/HEATMAP/*` — `lib/heatmap-build.ts:210-212` and
  `scripts/backfill-dc33-heatmap.ts:289` (plus a second re-assert on the round-tripped
  bytes at `:331`). Neither wraps the guard in a catch-and-continue, and
  `heatmap-build.test.ts:260-273` pins both the ordering and the throw-means-no-write
  behaviour. No bypass found.
- The `[year]` narrowing genuinely precedes key construction.
  `isHeatmapYear()` is a `.includes()` on a two-literal array with no normalisation
  (`heatmap-artifact.ts:36-40`), and the raw segment is never concatenated into
  anything. Live probe: `/heatmap/dc32` → 404, `/heatmap/../../ROUTES/x` → 404. No
  traversal reachable.
- No `userId`, `fileId`, S3 key or secret is interpolated into any `console.log` on
  the build or backfill paths.

That said, three claims the phase's own comments rest on are **factually false in this
deployment**, and I verified all three against live production rather than by reading:

1. The internal build route is **publicly reachable through CloudFront** — a raw
   `curl POST` from the open internet gets the route handler's own
   `{"error":"Forbidden"}` body back. The documented "second layer, not the only one"
   network posture does not exist, and the 71-08 probe's "non-2xx" assertion cannot
   tell the difference.
2. The public heat-map route is **not CDN-cached at all** — the `/use1/*` CloudFront
   behaviour uses Managed-CachingDisabled, so `s-maxage=900` is ignored. Every
   unauthenticated request is an S3 GetObject plus a 441 KB response off the single
   run.gpx task.
3. `export const maxDuration = 300` is inert under `output: "standalone"` on ECS, so
   the "CONTRACT WITH 71-07" that the Terraform timeout is written against does not
   bind anything.

Separately, the non-attributability guard is narrower than its own docstring: it never
inspects `meta`, never inspects `geometry.coordinates` contents, and never runs on the
serve path. Nothing attributable is leaking **today** — I checked the live bytes — but
the control has holes exactly where a future change would put data.

None of this is a merge blocker (the code is already live), but CR-01 and CR-03 are
worth a hotfix before the con, and CR-02 is a decision Kurt should make with the facts
in front of him.

## Critical Issues

### CR-01: The "internal-only" build route is reachable from the open internet; the shared secret is the sole control, compared non-constant-time, with no rate limiting

**File:** `apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts:12-30`
(claim), `infra/terraform/modules/cloudfront/v1.0.0/main.tf:498-515` (the behaviour that
falsifies it), `infra/terraform/live/site/services/run.gpx/service.hcl:318` (ALB rule
with no path patterns)

**Issue:** The route's header asserts:

> this route is reachable only at the VPC-private Cloud Map name, never through
> CloudFront. [...] no CloudFront behaviour maps `/api/gpx/internal/*`. The
> shared-secret guard below is the second layer, not the only one

This is not true. The CloudFront distribution has an ordered behaviour
`path_pattern = "/${region_label}/*"` with
`allowed_methods = [..., "POST", ...]` targeting the ALB, and the run.gpx ALB listener
rule has **no** `path_patterns` ("route all gpx.<domain> requests to run-gpx"). So
`/use1/api/gpx/internal/*` is forwarded straight to the app. Verified live:

```
$ curl -s -o - -w "%{http_code}\n" -X POST \
    https://gpx.defcon.run/use1/api/gpx/internal/heatmap-build
{"error":"Forbidden"}403
```

`{"error":"Forbidden"}` is this route handler's own line 29 response body — the request
reached the Next.js process. This is not a CloudFront or ALB rejection.

Consequences, in order of severity:

1. **The shared secret is the only control**, not the second layer. The comparison at
   line 28 is `request.headers.get("x-internal-secret") !== secret` — a short-circuiting,
   non-constant-time string compare on an internet-reachable endpoint. Timing extraction
   through CloudFront is not practical, but the mitigation is one line and the
   documented compensating layer is absent.
2. **No rate limiting, no lockout, no audit log of authorized invocations.** An
   attacker who ever obtains `AUTH_INTERNAL_SECRET` (shared with run.auth, so its blast
   radius is wider than this route) can POST in a loop; each authorized POST launches an
   unbounded `GpxFile.scan({pages:"all"})` plus one S3 GetObject per con-day run, on a
   single-task service, with no concurrency cap. That is a cheap amplification DoS
   against run.gpx during the con.
3. **The 71-08 probe validated nothing.** It requires a non-2xx from the public host; a
   403 from the app's own guard satisfies that identically to an unreachable path. The
   probe cannot distinguish the documented posture from the actual one.

Note this is an **inherited** pattern — `api/gpx/internal/strava-sync/route.ts:12` makes
the same false "never exposed via CloudFront" claim and is equally reachable. Phase 71
did not introduce the exposure, but it restated it as a security control and shipped a
probe that appeared to confirm it.

**Fix:** Three parts, cheapest first.

```ts
// 1. Constant-time compare, and reject the header before touching anything else.
import { timingSafeEqual } from "node:crypto";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length is not secret-dependent leakage worth protecting here, but the
  // buffers must match in size for timingSafeEqual.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
if (!secret || !secretMatches(request.headers.get("x-internal-secret"), secret)) {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

2. Correct the module comment so the next reader does not inherit the false posture.
3. Actually close the hole: add a CloudFront Function or WAF rule (or an ALB listener
   rule with higher priority returning a fixed 404) for
   `/{region}/api/*/internal/*` across the gpx and auth distributions. Fix once for
   both routes.

---

### CR-02: The artifact publishes untrimmed start/end GPS points at ~1.1 m precision for runners who never opted in — the guard proves "no identifiers", not "not re-identifiable"

**File:** `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts:123-143` (`normalizeTrack`),
`:183-212` (`assembleHeatmapArtifact`), `apps/run.gpx/webapp/src/lib/heatmap-build.ts:82-90`
(the D-03 selection)

**Issue:** This is **not** a request to re-litigate HEAT-06 or restore the
`includeInAggregate` predicate — that decision is locked and I am not proposing to
reverse it. The problem is orthogonal: the compensating control that was accepted in
exchange for dropping the opt-in gate does not cover the risk that dropping the opt-in
gate creates.

`assertNonAttributable` proves the artifact carries **no identifier fields**. It says
nothing about the geometry, and the geometry is the identifying part:

- `normalizeTrack` (line 138-141) decimates with a stride that **always preserves the
  first and last surviving point** — by design, and documented as such. So every
  published run keeps its exact start and end coordinate.
- `COORD_PRECISION = 5` (line 65) is ~1.1 m. The comment argues this is finer than a
  3 px 25 %-opacity line can express — true for rendering, irrelevant for anyone who
  reads the JSON, which is served unauthenticated at a stable public URL.
- Live DC33 artifact: 110 features, up to 300 points each, 441 KB of raw traces.

For a con where a meaningful fraction of runs start at the runner's hotel room door,
publishing the exact first point of every con-day run with no consent is the same class
of exposure as the 2018 Strava global-heatmap incident — the aggregate was
"anonymous"; the endpoints were not. A single runner on an otherwise-empty street is
individually traceable from this file without any identifier being present.

**Fix:** Keep D-03. Add an endpoint-privacy step to `assembleHeatmapArtifact`, which is
a pure function with full test coverage and costs nothing to change:

```ts
/** Metres of track trimmed from each end before publication. */
const ENDPOINT_TRIM_M = 200;

// in assembleHeatmapArtifact, after normalizeTrack:
const trimmed = trimEnds(coordinates, ENDPOINT_TRIM_M);
if (trimmed.length < 2) continue;
```

If trimming is judged to hurt the visual too much, the cheaper alternative is to drop
`COORD_PRECISION` to 4 (~11 m) — which the rendering argument in the comment already
concedes is invisible — and to trim only the first and last point. Either change is a
one-line diff to a pure function plus a test; both are strictly better than shipping
door-to-door traces. This needs Kurt's call, not a silent fix.

---

### CR-03: The public route is not CDN-cached — every unauthenticated hit is an S3 GetObject plus 441 KB off the single run.gpx task

**File:** `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts:36-43,
26-29` (the claim), `infra/terraform/modules/cloudfront/v1.0.0/main.tf:32, 512` (the
behaviour that falsifies it)

**Issue:** The route is sized and reasoned about as a CDN-absorbed surface:

> buys full CDN absorption of repeat load
> Each distinct query value is its own CDN cache entry

and `heatmap-artifact.ts:56` bounds `MAX_TRACK_POINTS` / `MAX_RUNS` explicitly for
"an UNAUTHENTICATED, CDN-cached public route". The `/use1/*` behaviour that serves this
path sets `cache_policy_id = local.cache_policy_disabled`
(`= "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"`, Managed-**CachingDisabled**), which makes
CloudFront ignore the origin's `s-maxage` entirely. Verified live — two back-to-back
requests, both misses:

```
$ curl -sD- -o/dev/null 'https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33?meta=1'
cache-control: public, s-maxage=900, stale-while-revalidate=900
x-cache: Miss from cloudfront          # request 1
x-cache: Miss from cloudfront          # request 2
```

So the shipped reality is: any unauthenticated client can issue `GET /heatmap/dc33` in a
loop, and each one costs the single run.gpx ECS task one S3 GetObject and a 441 KB
response body, with no cache, no rate limit and no auth. `MAX_RUNS = 5000` means the
artifact is permitted to grow to roughly 20× its current size — at which point one
request is ~9 MB off the origin. This is the most plausible availability failure mode
for the map during the con.

**Fix:** Add an ordered cache behaviour ahead of `/{region}/*` for the public heat-map
path with a real cache policy (Managed-CachingOptimized, or a custom policy that
includes the `meta` query string in the cache key):

```hcl
ordered_cache_behavior {
  path_pattern           = "/${region_key}/api/gpx/public/heatmap/*"
  target_origin_id       = "alb-${region_key}"
  viewer_protocol_policy = "redirect-to-https"
  allowed_methods        = ["GET", "HEAD", "OPTIONS"]
  cached_methods         = ["GET", "HEAD"]
  compress               = true
  cache_policy_id        = local.cache_policy_caching_optimized_query_meta
}
```

Until that lands, the `s-maxage` header and the "CDN-cached" comments in both source
files are misleading and should be corrected so nobody sizes another surface on the
same false premise.

## Warnings

### WR-01: `assertNonAttributable` never inspects `meta`, `coordinates` contents, or the root `type` — the chokepoint is narrower than its own docstring

**File:** `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts:214-291`

**Issue:** The function is documented as "the phase's SINGLE non-attributability
chokepoint" and "the compensating control that keeps the widened data set publishable".
What it actually checks: root key names, feature key names, `properties` emptiness,
geometry key names, `geometry.type === "LineString"`. What it does **not** check:

- `meta` — `ROOT_KEYS` allows the key, then nobody ever looks inside it. A future
  `meta: { topRunners: [...] }`, `meta: { userIds: [...] }` or a `meta.generatedBy`
  passes the guard untouched. The standalone `verify-heatmap-artifact.mjs:35-36, 74-82`
  **does** pin `META_KEYS` exactly — so the manual script is stricter than the runtime
  control on the write path, which is backwards.
- `geometry.coordinates` — never inspected at all. `coordinates: ["runner@example.test"]`
  or `coordinates: [{ userId: "…" }]` passes. This is the one field that actually
  carries data, and the guard billed as structural verification of untrusted output
  does not look at it. Again, the `.mjs` verifier does (`:129-147`).
- The root `type` value.

There is no live leak — I fetched both artifacts and confirmed root keys are exactly
`[type, meta, features]` and meta is exactly the four expected keys. The defect is that
the guard would not stop the leak it exists to stop. The test suite mirrors the gap:
`heatmap-artifact.test.ts:230-291` has no `meta` case.

**Fix:** Port the three missing checks from the `.mjs` verifier into the guard, and add
tests:

```ts
const META_KEYS = new Set(["year", "generatedAt", "runCount", "totalKm"]);

if (artifact.type !== "FeatureCollection") {
  throw new Error(`assertNonAttributable: root type is "${String(artifact.type)}"`);
}
const meta = artifact.meta;
if (!isPlainObject(meta)) throw new Error("assertNonAttributable: meta is not an object");
for (const k of Object.keys(meta)) {
  if (!META_KEYS.has(k)) {
    throw new Error(`assertNonAttributable: unexpected meta key "${k}"`);
  }
}
// ...and per feature:
const coords = geometry.coordinates;
if (!Array.isArray(coords)) throw new Error(`… features[${i}].coordinates not an array`);
for (const c of coords) {
  if (!Array.isArray(c) || c.length !== 2 ||
      typeof c[0] !== "number" || typeof c[1] !== "number") {
    throw new Error(`assertNonAttributable: features[${i}] has a non-numeric coordinate`);
  }
}
```

### WR-02: No guard on the serve path — the public route echoes whatever the S3 object contains, verbatim and unvalidated

**File:** `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts:79-95`

**Issue:** `JSON.parse(body) as HeatmapArtifact` is an unchecked type assertion, and the
parsed object is handed straight to `NextResponse.json(artifact)`. The write-path guard
is the only thing standing between a bad object and the public internet — so any write
that bypasses `lib/heatmap-build.ts` / the backfill (a manual `aws s3 cp` during an
incident, a future second builder, a restored-from-backup object, a compromised
`S3_UPLOADS_*` key pair) is published with no structural check at all. For a route whose
entire justification is "everything here is structurally non-attributable", the cheapest
defense-in-depth is to prove it on the way out too.

Secondary: `artifact.meta` (line 92) is not existence-checked. An object that parses to
`{}` yields `NextResponse.json(undefined)` — HTTP 200 with an empty body and
`content-type: application/json`, which the studio then fails to `.json()`. A 500 is the
honest answer.

**Fix:**

```ts
import { assertNonAttributable } from "@/lib/heatmap-artifact";
// …after JSON.parse:
try {
  assertNonAttributable(artifact);
} catch (error) {
  console.error("[heatmap] artifact failed the non-attributability check on read");
  return NextResponse.json({ error: "Failed to load heatmap" }, { status: 500 });
}
if (!artifact.meta) {
  return NextResponse.json({ error: "Failed to load heatmap" }, { status: 500 });
}
```

The cost is one structural walk per origin request — and once CR-03 puts a real cache in
front, that is a handful of walks per 15 minutes.

### WR-03: `maxDuration = 300` is inert on ECS, so the documented "CONTRACT WITH 71-07" does not bind — the invoker times out first and the scheduler retries into a still-running build

**File:** `apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts:43-50`,
`infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf:72-76`,
`infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl:131-134`

**Issue:** Two compounding problems.

1. `apps/run.gpx/webapp/next.config.ts:10` sets `output: "standalone"` and the app runs
   on ECS Fargate. `export const maxDuration` is a Vercel/serverless deployment hint —
   the standalone Node server does not enforce it. So the build route has **no** upper
   bound on runtime, and the number the Terraform contract is written against is
   fictional.
2. Even taking 300 at face value, `lambda_timeout = 300` is set **equal** to it, while
   the variable's own description says "MUST be >= the internal build route's
   maxDuration (300)". Equal is not enough: the Lambda's 300 s budget must also absorb
   the SSM `GetParameter` round trip, cold start, DNS and connection setup. A build that
   genuinely runs near 300 s kills the invoker *before* the response arrives, the
   invoker throws, and `retry_policy { maximum_retry_attempts = 2 }`
   (`main.tf:118-120`) fires up to two more invocations — each of which starts a fresh
   full rebuild while the first is still scanning. Three concurrent
   `GpxFile.scan({pages:"all"})` plus three fan-outs of S3 GetObjects on a single ECS
   task. Last-writer-wins on the object, so no corruption, but it is a self-inflicted
   load spike at exactly the moment the build is already slow.

**Fix:** Give the invoker real headroom and give the build a real bound.

```hcl
# terragrunt.hcl
lambda_timeout = 420   # 300 s build budget + SSM + connect + cold start
```

```js
// lambda/index.mjs — bound the fetch explicitly rather than relying on the Lambda kill
const res = await fetch(syncUrl, {
  method: "POST",
  headers: { "x-internal-secret": secret },
  signal: AbortSignal.timeout(300_000),
});
```

and either drop `maxDuration` (with a comment saying why it cannot work here) or
implement the bound in the builder itself — a deadline check in the chunk loop of
`heatmap-build.ts:183-203` that stops fetching and publishes what it has.

### WR-04: The two schedules collide at 04:00 PT on 5-10 August — a guaranteed double build every con day, with no concurrency control

**File:** `infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl:118-128`

**Issue:**

```hcl
hourly = "cron(0 * 5-10 8 ? 2026)"   # every hour, Aug 5-10 2026
daily  = "cron(0 4 * * ? *)"         # 04:00 every day
```

Both are evaluated in `America/Los_Angeles`, so on each of the six con days at 04:00 PT
**both** schedules fire in the same minute. EventBridge Scheduler invokes the Lambda
twice, and there is no `reserved_concurrent_executions` on the function
(`main.tf:47-96`), no idempotency key, and no lock in the builder — so two full
DynamoDB scans and two full S3 fan-outs run concurrently and both PutObject the same
key. The module header explicitly names overlapping builds as the landmine to avoid,
and then the live unit schedules one deterministically.

**Fix:** Make the two schedules disjoint, and cap concurrency as a backstop:

```hcl
hourly = "cron(0 * 5-10 8 ? 2026)"
daily  = "cron(30 4 * * ? *)"   # 04:30 — never coincides with a top-of-hour build
```

```hcl
# main.tf
resource "aws_lambda_function" "sync" {
  reserved_concurrent_executions = 1
  # …
}
```

### WR-05: `MAX_RUNS` truncation is silent — the artifact can drop runs while `runCount` still looks healthy

**File:** `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts:190-191`,
`apps/run.gpx/webapp/src/lib/heatmap-build.ts:205-217`

**Issue:** `assembleHeatmapArtifact` does `if (features.length >= MAX_RUNS) break;` and
then reports `runCount: features.length` — i.e. exactly 5000, which reads as a healthy
number, with no signal anywhere that runs were discarded. The builder's log line
(`heatmap-build.ts:215-217`) prints `scanned` / `kept` / `skipped`, none of which
reveals truncation either: a truncated build shows `scanned=6000 kept=5000 skipped=0`,
which is indistinguishable from "1000 runs had no geometry" only if you happen to notice
`kept` is exactly `MAX_RUNS`. The sibling aggregate route explicitly annotates its cap
with "log if exceeded"; this one does not.

Related waste: the builder fetches the GPX for **every** selected row before assembly
(`heatmap-build.ts:183-203`) and only then discards everything past 5000, so a
6000-row table pays 6000 S3 GetObjects to publish 5000 features.

**Fix:**

```ts
// heatmap-build.ts, after assembling:
if (artifact.meta.runCount >= MAX_RUNS) {
  console.warn(
    `[heatmap] dc34 TRUNCATED at MAX_RUNS=${MAX_RUNS} — ${tracks.length} tracks available`
  );
}
```

and stop the chunk loop once `tracks.length >= MAX_RUNS` so the S3 reads are bounded too.

### WR-06: 20 of 110 live DC33 features are degenerate `[[0,0],[0,0]]` null-island lines — `runCount` overstates real runs by 22 %

**File:** `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts:123-143` (`normalizeTrack` has
no null-island filter), `:190-201` (`assembleHeatmapArtifact` has no degeneracy filter),
`apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs:122-152` (the verifier passes
them)

**Issue:** This overlaps the already-filed
`2026-07-31-heatmap-dc33-paint-invisible-and-con-reprobe.md` todo, but that todo records
the symptom without the root cause or the second consequence, so both are worth pinning
here. I pulled the live artifact and characterised the 20 features precisely — every one
of them is **entirely** null island, not merely contaminated:

```
feature: 2 coordinates, [0,0] at indices [0, 1]   ×20
```

So they are zero-length lines at 0°N 0°E. Root cause is two missing filters:
`normalizeTrack` accepts `[0, 0]` because it is technically in range, and
`assembleHeatmapArtifact` drops only tracks with `< 2` coordinates, not tracks whose
coordinates are all identical. (The producing side is `decodeTrack` — `fromEncoded`
happily emits `[0,0]` when the accumulated deltas are zero, which a short or degenerate
DC33 `summary_polyline` will do.)

Second consequence, not in the todo: `meta.runCount` is **110** but only **90** are real
runs. That number is served publicly at `?meta=1` and rendered in the studio's HEAT MAP
section as "110 runs" (`HeatMap.svelte:39-41`). The `totalKm` figure is unaffected (a
zero-length line adds 0 km), which is itself a tell — 658.4 km across a claimed 110 runs
is 6.0 km/run, versus a truthful 7.3.

Third: `verify-heatmap-artifact.mjs` **passed** this artifact during 71-08. Its
"geometry is bounded LineString" check verifies range but not degeneracy, so the
verifier certified an artifact where 18 % of features are junk.

**Fix:** Filter at assembly (fixes both years, no backfill re-derivation needed beyond
a re-run), and tighten the verifier so it can never certify this again:

```ts
// heatmap-artifact.ts, in assembleHeatmapArtifact after normalizeTrack:
const coordinates = normalizeTrack(track);
if (coordinates.length < 2) continue;
// Reject degenerate geometry: a track that never moves is not a run.
const [lon0, lat0] = coordinates[0];
if (coordinates.every(([lon, lat]) => lon === lon0 && lat === lat0)) continue;
```

```js
// verify-heatmap-artifact.mjs, inside "geometry is bounded LineString":
const first = g.coordinates[0];
if (g.coordinates.every((c) => c[0] === first[0] && c[1] === first[1])) {
  fail(`features[${i}] is degenerate — every coordinate is [${first}]`);
}
```

Then re-run the DC33 backfill with `--apply` and update the
`HEATMAP_DC33_RUNCOUNT=` contract line in 71-04-SUMMARY.md.

### WR-07: The DC34 row renders and toggles ON while the artifact is empty — no geometry, no feedback, refetch on every toggle

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts:182-186,
255-299, 308-321`

**Issue:** This is live right now. `GET /heatmap/dc34` returns
`{"type":"FeatureCollection","meta":{…"runCount":0…},"features":[]}` — expected before
the con. But the studio treats "meta fetch succeeded" as `available: true`
(`:213-217`), so the DC34 row renders and its checkbox is enabled. Toggling it on:

1. `setVisible('dc34', true)` sets `this.visible.dc34 = true` and calls `ensureGeometry`.
2. `isFeatureCollection` requires `features.length > 0` (`:185`) → returns false → early
   return, **without** setting `built.dc34`.
3. `applyVisibility` finds no layer and no-ops.
4. The store is still updated to `visible: true` (`:315-319`) and
   `setLayerVisible(…, true)` **persists** it.

Net: the checkbox latches ON, nothing draws, no message is shown, and because `built`
stayed false every subsequent toggle re-fetches the full artifact. On the next page load
the persisted ON re-triggers the same fetch. A runner toggling DC34 before the con sees a
checked box that does nothing.

**Fix:** Distinguish "no artifact" from "artifact with no runs", and let a zero-feature
year be a legitimate empty layer:

```ts
// accept an empty FeatureCollection — an empty year is valid, just not yet populated
function isFeatureCollection(v: unknown): v is GeoJSON.FeatureCollection {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const o = v as { type?: unknown; features?: unknown };
    return o.type === 'FeatureCollection' && Array.isArray(o.features);
}
```

and gate the row itself on content rather than mere existence:

```ts
const available = meta !== null && (meta.runCount > 0);
```

Either alone fixes the latch; doing both also stops the repeat fetches.

### WR-08: Lambda IAM is over-scoped relative to its own "thin invoker / do NOT add data-plane permissions" header

**File:** `infra/terraform/modules/heatmap-scheduler/v1.0.0/iam.tf:71-74, 16-24, 77-90`

**Issue:** Three least-privilege gaps in a file that opens by declaring itself minimal:

1. `AWSLambdaVPCAccessExecutionRole` is attached **unconditionally**
   (`:71-74`, "Harmless to attach even when the Lambda runs with no VPC config"). That
   AWS-managed policy grants `ec2:CreateNetworkInterface`, `ec2:DeleteNetworkInterface`,
   `ec2:DescribeNetworkInterfaces` and `logs:CreateLogGroup`/`PutLogEvents` on
   `Resource: "*"` — notably `logs:*` on every log group in the account, which is
   strictly broader than the account-scoped, log-group-scoped statement written by hand
   at `:33-36`. It is not harmless; it is the widest grant in the module.
2. Neither assume-role policy carries a confused-deputy condition. The
   `scheduler.amazonaws.com` trust (`:77-90`) in particular is the one AWS explicitly
   documents as needing `aws:SourceAccount` — without it, any EventBridge Scheduler in
   any AWS account that learns this role ARN can attempt to assume it.
3. `xray:PutTraceSegments` / `PutTelemetryRecords` on `"*"` (`:38-41`) is unavoidable for
   those actions, so that one is fine — noted only so it is not mistaken for an
   oversight.

**Fix:**

```hcl
resource "aws_iam_role_policy_attachment" "sync_vpc" {
  count      = length(var.vpc_subnet_ids) > 0 ? 1 : 0
  role       = aws_iam_role.sync.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}
```

(Apply the same `aws:SourceAccount` condition to `sync_assume`.)

### WR-09: Raw AWS SDK error objects and arbitrary response bodies are logged, undercutting the T-71-08 log-hygiene claim

**File:** `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts:71, 84, 98`,
`infra/terraform/modules/heatmap-scheduler/v1.0.0/lambda/index.mjs:26, 33`

**Issue:** The phase's stated control is "no userId, fileId, S3 key or secret in any log
line", and the builder/backfill honour it scrupulously. The serve route and the invoker
Lambda do not:

- `console.error("[heatmap] artifact read failed:", error)` logs the whole SDK error.
  Node's `console.error` inspects enumerable own properties, and S3 `GetObject`
  exceptions carry `$metadata` (request ids), `$response`, and for several shapes the
  `BucketName` / `Key`. The route's own outer comment at `:97` says "Never echo the S3
  error, the bucket name or the key to the caller" — true for the *caller*, but the
  bucket name goes to CloudWatch anyway. Low sensitivity here (a fixed artifact key, not
  a per-user key), but it is the exact pattern that leaks a user key the next time this
  is copied.
- The route logs an error for every miss on an unbuilt year. Since the path is
  unauthenticated and (per CR-03) uncached, an outsider can drive CloudWatch error
  volume at will.
- `lambda/index.mjs:33` logs `body.slice(0, 500)` — 500 bytes of whatever the endpoint
  returned. Today that is the build result JSON; if `SYNC_URL` is ever wrong it is 500
  bytes of an arbitrary response.
- `lambda/index.mjs:26` puts the SSM parameter path into a thrown error message. Not a
  secret, but it is a pointer to one, and the throw surfaces in CloudWatch and in the
  scheduler's failure record.

**Fix:**

```ts
console.error(
  "[heatmap] artifact read failed:",
  error instanceof Error ? error.name : "unknown"
);
```

and in the Lambda, log only `res.status` plus a byte count, keeping the body for the
non-2xx branch where it is diagnostically necessary.

## Info

### IN-01: `dedupe`'s sort comparator returns a non-zero value for equal elements

**File:** `apps/run.gpx/webapp/src/lib/heatmap-build.ts:160-162`

**Issue:** `(a, b) => a.createdAt - b.createdAt || (a.fileId < b.fileId ? -1 : 1)` returns
`1` when `a.fileId === b.fileId`, violating the comparator contract (`compare(x, x)`
must be 0). Harmless today because the input comes from a `Map` keyed on `fileId`, so
duplicates cannot occur — but it is an inconsistent comparator one refactor away from
producing implementation-defined ordering, which would break the "deterministic output"
property the function exists to provide.

**Fix:** `(a, b) => a.createdAt - b.createdAt || a.fileId.localeCompare(b.fileId)`

### IN-02: `?meta=` is a truthiness test, so `?meta=0` returns meta and `?meta=` returns the full artifact

**File:** `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts:91`

**Issue:** `if (new URL(request.url).searchParams.get("meta"))` treats any non-empty
value as "meta mode" — `?meta=0` and `?meta=false` both project meta — while `?meta=`
(present but empty) returns the full 441 KB artifact. The studio only ever sends
`meta=1`, so nothing is broken, but the contract is looser than the comment describes.
Once CR-03 puts a real cache policy in place, an arbitrary query value will also mint an
arbitrary cache entry, so the tightening is worth doing at the same time.

**Fix:** `if (new URL(request.url).searchParams.get("meta") === "1")`

### IN-03: `fromEncoded`'s finite check is unreachable

**File:** `apps/run.gpx/webapp/src/lib/polyline-decode.ts:117`

**Issue:** `if (!Number.isFinite(outLat) || !Number.isFinite(outLng)) continue;` cannot
fire — `lat`/`lng` are accumulated from `|`/`>>` results, which are always 32-bit
integers, and dividing an integer by `1e5` is always finite. Dead defensive code. Note
also that `continue` here would skip the point *silently* while keeping the running
`lat`/`lng` accumulators, which is the wrong recovery if it ever did fire (the module's
stated policy elsewhere is bail, not salvage).

**Fix:** Delete the check, or convert it to a `return null` consistent with the rest of
the function's bail-don't-salvage contract.

### IN-04: An empty-string `INTERNAL_SYNC_SECRET` pins the internal route to a permanent silent 403

**File:** `apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts:27`

**Issue:** `process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET` uses
`??`, which only falls back on `null`/`undefined`. If `INTERNAL_SYNC_SECRET` is ever set
to the empty string (a trivially easy Terraform/SSM mistake), the fallback to the
working `AUTH_INTERNAL_SECRET` does **not** happen, `!secret` is true, and every
invocation 403s forever with no log line at all. The heat map then silently stops
updating and nothing pages. The security posture is correct (fails closed); the
observability is not.

**Fix:** Use `||` instead of `??`, and log once at startup (or on the 403 path, rate
limited) when no secret is configured:

```ts
const secret = process.env.INTERNAL_SYNC_SECRET || process.env.AUTH_INTERNAL_SECRET;
if (!secret) {
  console.error("[heatmap] no internal secret configured — build endpoint is disabled");
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

### IN-05: `HeatmapLayer.remove()` leaves `heatmapState` stale, and `whenStyleReady()` can never resolve

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts:197-200,
323-332`

**Issue:** Two small robustness gaps:

- `remove()` resets `built` / `visible` but not the exported `heatmapState` store, so
  between a teardown and the next `loadMeta()` the HEAT MAP section still renders rows
  for a layer that no longer exists. `LayerControl.svelte:291-296` calls
  `remove()` then immediately re-creates and `void loadMeta()`s, so the window is short
  and the fetch overwrites it — but the store is documented as the section's source of
  truth and it briefly is not.
- `whenStyleReady()` returns a promise resolved only by a one-shot `map.once('idle')`.
  If the map never reaches idle (a style load that fails, a tab backgrounded before
  first idle), the promise never settles, so the `await` in `setVisible` never returns
  and that year's toggle never persists — with no timeout and no rejection.

**Fix:** `remove()` should `heatmapState.set(blankState())`. `whenStyleReady()` should
race the `idle` listener against a timeout so the caller always makes progress.

---

_Reviewed: 2026-07-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard, with live production verification of CR-01, CR-03, WR-06 and WR-07_
