---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 11
subsystem: run.gpx internal heat-map build route + DC34 artifact builder
status: complete
tags: [security, non-disclosure, timing-safe, availability, dos, observability, gap-closure, tdd]
gap_closure: true
requirements: [HEAT-02]

dependency_graph:
  requires:
    - "71-02 — the internal heatmap-build route and its secret gate"
    - "71-01 — heatmap-artifact.ts (MAX_RUNS, assembleHeatmapArtifact, assertNonAttributable)"
    - "71-10 — the stricter assertNonAttributable/assembly the builder now writes through"
  provides:
    - "BUILD_BUDGET_MS = 240000 ms — the build's ONLY real wall-clock bound, and the number 71-14 codes the outer two against"
    - "A constant-time secret comparison on the sole control guarding an internet-reachable endpoint"
    - "A bare 404 on every denial, so the endpoint no longer confirms its own existence"
    - "An empty-string INTERNAL_SYNC_SECRET that falls back instead of silently disabling the heat map"
    - "A log line on the unconfigured-secret path, which previously paged nobody"
    - "A route comment that states the MEASURED network posture instead of a control that does not exist"
  affects:
    - "71-13 — named in the route comment as the plan that adds the real edge block; also covers the strava-sync sibling"
    - "71-14 — MUST set the invoker fetch abort to 300s and lambda_timeout to 420s against BUILD_BUDGET_MS = 240000"
    - "71-16 — the release that carries this to production; NOT live until then"

tech_stack:
  added: []
  patterns:
    - "Non-disclosure: every denial collapses to a bare 404, never 403/401 (ported from run.human's admin routes)"
    - "timingSafeEqual behind an explicit equal-length guard — the length check is a precondition of the primitive, not the leak being defended"
    - "|| not ?? for env fallbacks, so an empty-string misconfiguration falls through instead of failing permanently"
    - "Fail closed, but LOUDLY — a disabled subsystem must not look like a routine unauthenticated probe in the logs"
    - "Abort, do not shrink: a deadline aborts the build rather than publishing a partial artifact"
    - "Bound TOTAL work at the cap, not just concurrent work"

key_files:
  created:
    - "apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.test.ts"
  modified:
    - "apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts"
    - "apps/run.gpx/webapp/src/lib/heatmap-build.ts"
    - "apps/run.gpx/webapp/src/lib/heatmap-build.test.ts"

decisions:
  - "BUILD_BUDGET_MS = 240000 ms is the phase's authoritative build bound; 71-14 must set invoker fetch abort 300s and lambda_timeout 420s (strictly increasing, never equal)"
  - "The inert maxDuration export was DELETED rather than kept with a corrected comment — a fictional number that reads as settled is worse than no number"
  - "Deadline breach ABORTS without publishing; a truncated artifact overwriting a complete one during the con is worse than a one-interval-stale one"
  - "Every denial on the internal build route is a bare 404 (non-disclosure), not a 403"
  - "compareRunRows exported so the equal-elements property can be asserted directly — the Map keyed on fileId makes it unreachable through the public path, which is why the bug survived"
  - "Rate limiting / lockout / audit log on the internal route DEFERRED to the 71-13 edge block, named in the threat register rather than omitted (T-71-11-06 accepted)"
  - "The identical false posture comment in strava-sync/route.ts was deliberately NOT edited — out of scope, covered by 71-13 at the network layer, filed for post-con"

metrics:
  duration: "~20m"
  completed: 2026-07-31
  tasks: 2
  commits: 4
  files_modified: 3
  files_created: 1
  tests_before: 313
  tests_after: 331
---

# Phase 71 Plan 11: Internal Build Route Hardening & A Build Bound That Exists Summary

Closed the application half of CR-01 — constant-time secret, bare 404, and a network-posture
comment that states what a live probe measured instead of a control that does not exist —
and gave the builder its first real wall-clock bound, `BUILD_BUDGET_MS = 240000`, enforced in
its own chunk loop and aborting without publishing.

## What Changed

### Task 1 — `api/gpx/internal/heatmap-build/route.ts` (CR-01 application half, IN-04)

| Before | After |
|--------|-------|
| `request.headers.get("x-internal-secret") !== secret` — short-circuiting compare on an internet-reachable endpoint | `timingSafeEqual` behind an explicit equal-length guard (T-71-11-01) |
| `403 {"error":"Forbidden"}` — the exact body a live probe got back from the open internet | bare `404`, no body (T-71-11-02) |
| `INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET` | `\|\|`, so an empty-string primary falls through (IN-04) |
| unconfigured secret → permanent silent rejection, no log | one `[heatmap]`-prefixed `console.error` naming both variables |
| "reachable only at the VPC-private Cloud Map name"; the guard is "the second layer, not the only one" | the measured reality: the region-wildcard CDN behaviour forwards `/{region}/*` including POST, the ALB rule carries no path patterns, and the guard in this file is the SOLE control today |
| `export const maxDuration = 300` + a "CONTRACT WITH 71-07" comment | export DELETED; a comment names the real bound and the 240/300/420 chain |

The rewritten posture block also tells the next reader **not** to restate an unverified network
claim, and explains *how* the original one survived review: the 71-08 probe required a non-2xx
from the public host, which the guard's own denial satisfied identically to an unreachable path.
The 71-13 probe assertion is named as the thing that distinguishes them.

**Why the `maxDuration` export was deleted rather than annotated.** `next.config.ts` sets
`output: "standalone"` and the app runs on ECS Fargate, so the export is a serverless
deployment hint the standalone Node server never enforces. It bounded nothing — yet
`infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf:73` still describes
`lambda_timeout` as needing to be `>= the internal build route's maxDuration (300)`. That
description is written against a number nothing produced. Leaving a corrected comment beside
a fictional export invites the next reader to keep coding against it; deleting it and naming
the real bound in its place leaves exactly one number in play.

### Task 2 — `lib/heatmap-build.ts` (WR-03, WR-05, IN-01)

**`BUILD_BUDGET_MS = 240_000` — the number 71-14 needs.** Captured from the injectable `now`
dep before the chunk loop and re-checked at the **top of every chunk iteration**, because
between chunks is the only place the loop can be interrupted safely. On breach it **throws**:

```
[heatmap] dc34 build exceeded its 240000 ms wall-clock budget after N chunk(s) — aborting without publishing
```

It is the innermost link of a **strictly increasing** chain, documented at the constant:

| Link | Value | Owner |
|------|-------|-------|
| builder abort | **240 s** (`BUILD_BUDGET_MS`, this plan) | `lib/heatmap-build.ts` |
| invoker Lambda fetch `AbortSignal` | 300 s | plan 71-14 |
| Lambda `lambda_timeout` | 420 s | plan 71-14 |

Never equal. Equal budgets are what WR-03 actually described: the Lambda is killed before the
response arrives, `maximum_retry_attempts = 2` fires two more invocations, and each starts a
fresh full rebuild while the first is still scanning — three concurrent unbounded scans plus
three S3 fan-outs on a single ECS task, at exactly the moment the build is already slow.

**Abort, do not shrink.** Publishing what was collected so far would overwrite a complete
artifact with a truncated one and report the truncated count as healthy. Pinned by a test that
asserts `putArtifact` was never called and `guard.order` is empty (T-71-11-05).

**Bounded S3 reads.** `if (tracks.length >= MAX_RUNS) break;` at the top of the loop. The
builder used to load every selected row and only then discard everything past the cap — a
6000-row table paid 6000 GetObjects to publish 5000 features. `CHUNK_SIZE`'s bounded-concurrency
structure is untouched: the break bounds TOTAL work, the chunk width still bounds CONCURRENT work.

**Loud truncation.** `console.warn` when `runCount >= MAX_RUNS`, matching the sibling aggregate
route's convention. Counts only — `selected` / `collected` / `published`, no userId, no fileId,
no S3 key.

**Consistent comparator (IN-01).** `(a.fileId < b.fileId ? -1 : 1)` returned `1` for equal
elements. Now `a.fileId.localeCompare(b.fileId)`, extracted as an exported `compareRunRows` so
`compare(x, x) === 0` can be asserted directly — the `Map` keyed on `fileId` makes equal
elements unreachable through the public path, which is precisely why the bug survived.

## Prohibitions Held

| Prohibition | Evidence |
|-------------|----------|
| No opt-in / `includeInAggregate` / `publicShareEligible` predicate restored (D-03, user-locked) | grep count `0`; the D-03 regression test still passes untouched |
| No partial publish on deadline | dedicated test asserts `putArtifact` never called and `guard.order` is `[]` |
| `assertNonAttributable` still called, still immediately before `putArtifact`, never in a continuing catch | grep count `2`; read back at lines 295→297 with only a blank line between |
| `CHUNK_SIZE`'s bounded-concurrency structure unchanged | still `slice(i, i + CHUNK_SIZE)` into one `Promise.all`; only exported for the test's overshoot allowance |
| HEAT-06 / D-14 not re-litigated | neither file touched on that axis |

## TDD Gate Compliance

Both tasks ran RED → GREEN with the RED committed separately.

| Gate | Commit | Evidence |
|------|--------|----------|
| RED (route) | `5875b81d` | 5 of 8 failed against the shipped source: 403 where 404 expected, empty-string fallback 403, no log |
| GREEN (route) | `18ad483f` | 8/8 |
| RED (builder) | `da39388d` | 8 of 8 new failed (17 existing passed): promise resolved instead of rejecting, `CHUNK_SIZE` undefined, `compareRunRows is not a function` |
| GREEN (builder) | `77116441` | 25/25 |

No REFACTOR commit — neither implementation needed one.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run` (full suite) | **331 passed / 1 skipped** — baseline 313/1, +18, zero failures, no new skips |
| `npx tsc --noEmit` | exit **0** |
| Task 1 acceptance greps (9) | all pass: `timingSafeEqual` 2, old compare 0, `status: 403` 0, `status: 404` 1, `?? ` fallback 0, `console.error` 2, "second layer" 0, "never through cloudfront" 0, "71-13" 3 |
| Task 2 acceptance greps (9) | all pass: `240_000` 1, `throw new Error` 1, `MAX_RUNS` 4, `console.warn` 1, `localeCompare` 1, old tie-break 0, D-03 prohibition 0, `assertNonAttributable` 2, identifier-in-log 0 |
| Chokepoint adjacency (re-read, verification step 3) | line 295 `assertNonAttributable(artifact);` → 297 `await putArtifact(...)`, nothing between |
| Lint | none — eslint is non-functional in this package (D-71-A/C) |

Node 22.12.0 via nvm; the repo's default 22.1.0 cannot load `vitest.config.ts` (`ERR_REQUIRE_ESM`).

## Deviations from Plan

**None affecting behaviour.** Two implementation choices the plan left open, recorded because
they are load-bearing for later plans:

1. **`maxDuration` deleted rather than kept-with-a-corrected-comment.** The plan permitted
   either. Deleting removes the fictional number entirely; the replacement comment names
   `BUILD_BUDGET_MS` and its value so the Terraform side has exactly one number to code against.
2. **`compareRunRows` and `CHUNK_SIZE` exported.** The plan allowed "a direct comparator test or
   a stable-output assertion". A direct test needs the seam, and the cap test needs the overshoot
   allowance without hard-coding a literal that would go stale. Neither export changes behaviour;
   `CHUNK_SIZE`'s bounded-concurrency structure is byte-identical.

No auto-fixes were required (no Rule 1/2/3 deviations), and no architectural question arose.

## Deliberately NOT Closed (named, not omitted)

- **Rate limiting / lockout / audit log** on the internal route (T-71-11-03 partial, T-71-11-06
  accepted). The 71-13 edge block removes the internet reachability that makes them matter, and
  adding request-counting state to a single-task service days before the con is new failure
  surface for no marginal gain.
- **`api/gpx/internal/strava-sync/route.ts`** carries the identical inherited false posture claim
  and is equally reachable. Not edited — out of this plan's scope, covered by 71-13 at the
  network layer, filed for post-con.
- **`infra/.../heatmap-scheduler/v1.0.0/variables.tf:73`** still describes `lambda_timeout` as
  bounded by "the internal build route's `maxDuration` (300)", which no longer exists. **Plan
  71-14 must update it to reference `BUILD_BUDGET_MS = 240000` and set 300 s / 420 s.**

## For Plan 71-14 (the one number it needs)

```
BUILD_BUDGET_MS = 240_000   // apps/run.gpx/webapp/src/lib/heatmap-build.ts
```

Set the invoker Lambda's fetch `AbortSignal` to **300 s** and `lambda_timeout` to **420 s**.
Strictly increasing, never equal.

## Not Live

Source only. Production is still run.gpx v0.0.109 until plan 71-16 releases.

## Self-Check: PASSED

All 4 source files and the SUMMARY exist on disk; all 4 commit hashes
(`5875b81d`, `18ad483f`, `da39388d`, `77116441`) resolve in `git log`.
