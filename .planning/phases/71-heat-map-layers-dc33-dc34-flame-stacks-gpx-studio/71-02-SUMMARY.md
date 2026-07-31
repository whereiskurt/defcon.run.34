---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 02
subsystem: run.gpx/webapp lib + internal API route
tags: [heatmap, batch-builder, privacy, d-03, internal-route, shared-secret, tdd]
status: complete
requires:
  - "71-01: assembleHeatmapArtifact / assertNonAttributable / heatmapArtifactKey / trkptCoords"
provides:
  - "lib/heatmap-build.ts — buildDc34Heatmap(deps?) → HeatmapBuildResult"
  - "BuildDeps injectable seam (listRuns / loadGpx / putArtifact / now)"
  - "HeatmapRunRow — the narrowed GpxFile view the builder reads (no opt-in flag)"
  - "POST /api/gpx/internal/heatmap-build — shared-secret-guarded rebuild trigger"
  - "maxDuration = 300 — the floor 71-07's lambda_timeout must meet"
affects:
  - "71-03 serve route: reads the object this builder writes at uploads/HEATMAP/dc34.json"
  - "71-04 DC33 backfill: copies defaultPutArtifact's PutObjectCommand shape"
  - "71-07 Terraform invoker: lambda_timeout >= 300 and POSTs x-internal-secret to this route"
  - "71-08 live verification: probes the public host for /api/gpx/internal/heatmap-build and requires non-2xx"
tech-stack:
  added: []
  patterns:
    - "Injectable-deps batch service (gpx-reconcile.ts idiom) — unit-testable with no DynamoDB and no S3"
    - "Bounded fan-out in sequential chunks of 20 rather than one unbounded Promise.all"
    - "Non-injectable privacy chokepoint: assertNonAttributable is NOT a BuildDeps member, so no caller can swap it out"
    - "Internal route posture copied structurally from api/gpx/internal/strava-sync/route.ts"
key-files:
  created:
    - apps/run.gpx/webapp/src/lib/heatmap-build.ts
    - apps/run.gpx/webapp/src/lib/heatmap-build.test.ts
    - apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts
  modified: []
decisions:
  - "71-02: HeatmapRunRow deliberately does NOT declare includeInAggregate — the builder's row contract names only fields it reads, so a future 'restore the predicate' edit has to re-add the field and trip the D-03 test (also satisfies the plan's zero-occurrences acceptance criterion)"
  - "71-02: the D-03 opt-in subtraction is documented at the selection block with an explicit DO-NOT-RESTORE warning naming Kurt's 2026-07-30 decision and the compensating control, so the omission cannot be misread as an oversight"
  - "71-02: assertNonAttributable is intentionally absent from BuildDeps — tests exercise ordering by wrapping the module export with vi.mock, not by injecting a surrogate, so production code has no seam that could bypass the guard"
  - "71-02: dedup is deterministic by construction — earliest createdAt wins, ties break on fileId string order, and output is sorted — so two runs over the same table produce byte-identical artifacts"
  - "71-02: the internal route reads no request body; a DC34 rebuild takes no parameters and no knob was added without a caller"
metrics:
  duration: ~35 min (across one watchdog-interrupted session and this continuation)
  completed: 2026-07-31
  tasks: 2
  commits: 3
  tests_added: 15
  files_created: 3
---

# Phase 71 Plan 02: DC34 Heat-Map Builder & Internal Build Route — Summary

The batch service that turns every con-day-assigned run into the published DC34 heat-map
artifact — selection with **no owner opt-in gate** (D-03), Strava dedup, bounded S3
fan-out, and `assertNonAttributable()` sitting immediately before the only write — plus
the shared-secret-guarded internal route the scheduled invoker POSTs. 15 new vitest cases,
zero new npm dependencies.

## What Was Built

### Task 1 — `lib/heatmap-build.ts` (15 tests)

`buildDc34Heatmap(deps?)` → `{ year, generatedAt, runCount, totalKm, scanned, skipped }`.

**The selection is the requirement.** Structurally it is
`api/gpx/public/aggregate/route.ts:37-42` with the `includeInAggregate` clause *removed*:

```
status = "active"  AND  conDay exists  AND  userId <> "GLOBAL"
```

then narrowed in JS to `conDay ∈ CON_DAYS[].date`. That membership test is the "dc34 year"
selector, and because it reads the same list the con-day picker writes, *a run tagged for
the con* and *a run in the artifact* are the same set by construction.

The subtraction carries a block comment naming Kurt's 2026-07-30 decision (D-03), the
compensating control, and an explicit **DO NOT restore the missing predicate** — plus a
pointer at the test that fails if someone does. `HeatmapRunRow` was also narrowed so the
flag is not even in the builder's row contract: restoring the predicate now requires
re-adding a field, which is a louder edit than flipping a condition.

| Step | Behaviour |
|---|---|
| `listRuns` | ElectroDB `scan.where(...).go({pages:"all"})`, D-03 predicate above |
| dedup | Rows sharing a non-empty `stravaActivityId` collapse to the earliest `createdAt` (ties on `fileId` string order), then de-dup on `fileId`, then sort — deterministic output |
| `loadGpx` | `GetObjectCommand` + `transformToString()` (mirrors `gpx-reconcile.ts:72-75`) |
| fan-out | Sequential chunks of **20**, not one unbounded `Promise.all` — the aggregate route can afford unbounded only because it caps at 500 routes; a precomputed builder has no cap (T-71-06) |
| failure | Per-row `try/catch`: an unreadable object or a <2-point track increments `skipped` and never aborts the batch |
| assemble | `assembleHeatmapArtifact('dc34', now().toISOString(), tracks)` |
| **guard** | `assertNonAttributable(artifact)` — line 210, no try/catch |
| write | `putArtifact(heatmapArtifactKey('dc34'), JSON.stringify(artifact))` — line 212 |
| log | One `[heatmap]` line: `scanned / kept / skipped / totalKm`. No `userId`, no `fileId`, no S3 key (T-71-08) |

`assertNonAttributable` is deliberately **not** a `BuildDeps` member. It is a hard,
non-injectable chokepoint, so there is no production seam that could bypass it. The test
suite proves ordering by wrapping the module export with `vi.mock` and recording
`["guard", "put"]`, and proves the fail-closed behaviour by forcing the guard to throw and
asserting `putArtifact` was never called.

### Task 2 — `POST /api/gpx/internal/heatmap-build`

Structurally copied from the `strava-sync` sibling:

- **Guard first, before any work.** `process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET`
  (the fallback exists because the invoker Lambda names it one thing and the deployed task
  carries the other — comment carried forward). Missing secret or mismatched
  `x-internal-secret` → `403 Forbidden` at line 29, before the build call at line 33 (T-71-05).
- **`POST` only.** No `GET`/`HEAD`/`PUT`/`DELETE` export, so Next returns 405 for them.
- **No body read** — a DC34 rebuild takes no parameters. No knob without a caller.
- Success → `{ ok: true, ...result }`; failure → `console.error` on `[heatmap]` and a
  generic `{ error: "Heatmap build failed" }` 500 that never leaks exception text (T-71-08).
- `export const maxDuration = 300`, with a comment tying it to 71-07's `lambda_timeout`:
  if the invoker times out first, the scheduler retries while the build still runs and the
  next run overlaps it.
- Module doc records the network posture: VPC-private Cloud Map name only, never through
  CloudFront; 71-08 probes the public host and requires a non-2xx.

## Verification

| Check | Result |
|---|---|
| `npx vitest run src/lib/heatmap-build.test.ts` | **15 passed** (plan required ≥12) |
| `npm test` (whole suite) | **303 passed, 1 skipped, 35 files** — no regression (71-01 baseline was 288) |
| `npx tsc --noEmit -p tsconfig.json` | exit **0** |
| `npm run build` | succeeds; route manifest lists `ƒ /api/gpx/internal/heatmap-build` |
| `grep -v '^\s*[/*]' heatmap-build.ts \| grep -c includeInAggregate` | **0** (comment-only mention retained, as the criterion allows) |
| `assertNonAttributable` line vs last `putArtifact(` line | **210 < 212** — guard precedes write |
| `grep -c heatmapArtifactKey heatmap-build.ts` | **2**; hand-written `uploads/HEATMAP` in code lines: **0** |
| `grep -c CON_DAYS` / `grep -c "\[heatmap\]"` | **3** / **1** |
| `grep -c x-internal-secret route.ts` | **1** |
| `grep -c "INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET"` | **1** |
| `grep -c "export const maxDuration = 300"` | **1** |
| `grep -Ec "export async function (GET\|HEAD\|PUT\|DELETE)"` | **0** |
| 403 line (29) vs `buildDc34Heatmap(` call line (33) | guard branch precedes the build |
| `git diff --stat apps/run.gpx/webapp/package.json` | **empty — no dependency added** (T-71-SC) |
| Deletions across all three commits | **none** |

Test coverage maps 1:1 onto the plan's `<behavior>` list: the five exclusion cases
(non-active, no `conDay`, `conDay` outside `CON_DAYS`, `GLOBAL` owner), **the D-03
inclusion case**, both dedup cases, both geometry-failure cases, the result/clock case,
the one-put/zero-properties case, a re-run of the genuine guard against the written body,
and the two chokepoint-ordering cases.

`npm run lint` was **not** run — it is non-functional app-wide in `run.gpx/webapp`
(pre-existing eslint circular-config crash, logged as **D-71-A** in `deferred-items.md`
by 71-01). `tsc --noEmit` + `vitest` + `npm run build` were the gates.

**Node version:** all runs used `~/.nvm/versions/node/v22.12.0` — vitest in this app needs
Node ≥22.12 (default `v22.1.0` dies at config load with `ERR_REQUIRE_ESM` on `std-env`).

## Deviations from Plan

### Execution interruption and recovery

**1. [Rule 3 — Blocking] Previous executor killed mid-plan by a stream watchdog**
- **Found during:** session start (this agent is the continuation)
- **Issue:** The first executor committed Task 1's RED tests (`089d24ac`) and wrote the
  GREEN implementation, but was killed by a 600-second no-progress watchdog before it
  could self-verify or commit. `heatmap-build.ts` (227 lines) was left **untracked** in
  the working tree with no commit behind it.
- **Fix:** Adopted the orphaned file rather than rewriting it, audited it line-by-line
  against Task 1's `<action>` and every `<acceptance_criteria>` item, fixed the one
  criterion it failed (below), re-ran the suite and `tsc`, then committed it as the GREEN
  commit. No work was lost and no work was redone.
- **Commit:** `8fa3bd21`

### Auto-fixed issues

**2. [Rule 1 — Bug] `includeInAggregate` declared on `HeatmapRunRow` violated the D-03 criterion**
- **Found during:** the Task 1 audit
- **Issue:** The adopted implementation typed `includeInAggregate?: boolean` on
  `HeatmapRunRow` (annotated "deliberately UNREAD, typed only so the test can set it").
  That is a code line, so
  `grep -v '^\s*[/*]' heatmap-build.ts | grep -c includeInAggregate` returned **1** where
  the acceptance criterion requires **0**. Beyond the criterion this was the weaker
  design: keeping the flag in the builder's row contract makes "restore the predicate" a
  one-condition edit.
- **Fix:** Removed the field from `HeatmapRunRow` (its doc comment now records *why* the
  entity's opt-in flag is absent) and widened only the test's override type via a local
  `RowOverrides = Partial<HeatmapRunRow> & { includeInAggregate?: boolean }`. The D-03
  test still sets the flag and still proves it is ignored — the row carries it at runtime
  regardless of the compile-time view.
- **Files modified:** `src/lib/heatmap-build.ts`, `src/lib/heatmap-build.test.ts`
- **Commit:** `8fa3bd21`

### Criteria wording clarified

**3. Task 2's `x-internal-secret` count criterion**
- The criterion requires `grep -c "x-internal-secret"` to return exactly `1`. The first
  draft's module doc also named the header ("Guarded by `x-internal-secret`"), yielding 2.
  Reworded the doc to "Guarded by the shared internal secret header checked below" — the
  header name still appears four lines later in the code that reads it, so nothing is lost.

**4. Task 2's 403-before-build ordering criterion**
- Written as `grep -n "403"` vs `grep -n "buildDc34Heatmap"`, whose *first* match is the
  top-of-file `import` (line 2), so the comparison cannot hold literally for any file that
  imports the function by name. Verified against the call form
  (`grep -n "buildDc34Heatmap("` → line 33 vs 403 at line 29), which is the criterion's
  unambiguous intent and matches how Task 1's sibling criterion was written
  (`grep -n "putArtifact(" | tail -1`). The import was left idiomatic rather than
  contorted into a namespace import to satisfy a grep.

### Housekeeping

**5. Build artifacts kept out of every commit**
- `apps/run.gpx/webapp/tsconfig.tsbuildinfo` and `next-env.d.ts` are **tracked** files that
  `tsc --noEmit` and `next build` rewrite on every run (`next-env.d.ts` flips its route-types
  import between `./.next/dev/types/` and `./.next/types/` depending on dev vs prod build).
  Both were `git restore`d before staging and every commit staged files explicitly by path —
  no `git add -A`. Neither appears in any 71-02 commit.

## Deferred Issues

None new. **D-71-A** (eslint circular-config crash, app-wide) remains open in
`deferred-items.md` from 71-01 and continues to block the plan's `npm run lint` gate.

## Known Stubs

None. Both files are complete and wired end to end: the route calls the real builder, the
builder's default deps hit real ElectroDB and real S3, and nothing returns a hardcoded
empty or placeholder value. The builder is not yet *invoked* by anything — the EventBridge
schedule and invoker Lambda are 71-07's deliverable, which is sequencing, not a stub.

## Threat Flags

None beyond the plan's register. One new network endpoint was introduced and it is the
endpoint the plan's threat model already enumerates:

| Threat | Status |
|---|---|
| T-71-05 (EoP on the internal route) | `x-internal-secret` equality guard returns 403 before any work; VPC-private posture documented; 71-08 probes the public host |
| T-71-06 (DoS via fan-out) | Chunks of 20 + `MAX_RUNS` cap in the assembler + `maxDuration = 300`; unauthenticated callers cannot reach the route at all |
| T-71-07 (attributable data in the artifact) | `assertNonAttributable` on the write path, no catch-and-continue, enforced by source ordering **and** by two ordering/fail-closed tests |
| T-71-08 (log/error disclosure) | `[heatmap]` line carries counts only; route logs detail to CloudWatch and returns a generic 500 message |
| T-71-09 (`!==` secret comparison) | Accepted, per plan — parity with the shipped strava-sync guard |
| T-71-SC (supply chain) | Zero packages installed; empty `package.json` diff |

## Notes for Later Plans

- **71-07 must set `lambda_timeout >= 300`.** The route declares `maxDuration = 300`; a
  shorter invoker timeout makes the scheduler retry while the build is still running and
  the next run overlaps it.
- **71-07's invoker must send the `x-internal-secret` header** and target the VPC-private
  Cloud Map name, not the public host.
- **71-04 should copy `defaultPutArtifact`'s shape** (`PutObjectCommand` with `BUCKET`,
  `heatmapArtifactKey(...)`, `ContentType: "application/json"`) and must call
  `assertNonAttributable` immediately before its own write.
- **71-03 reads `uploads/HEATMAP/dc34.json`** — always via `heatmapArtifactKey()`.
- **Do not "restore" the `includeInAggregate` predicate** in the DC34 selection. It is a
  user-locked decision (D-03/HEAT-06), the artifact's non-attributability is the
  compensating control, and a test fails if you do.
- **Run tests under Node ≥22.12**; `npm run lint` is still broken app-wide (D-71-A).

## Self-Check: PASSED

All three created files exist on disk:
`src/lib/heatmap-build.ts`, `src/lib/heatmap-build.test.ts`,
`src/app/api/gpx/internal/heatmap-build/route.ts`.
Both feature commits resolve in `git log`: `8fa3bd21`, `c00ba959` (plus the pre-existing
RED commit `089d24ac` from the interrupted session).
