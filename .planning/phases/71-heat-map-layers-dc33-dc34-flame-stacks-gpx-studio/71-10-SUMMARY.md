---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 10
subsystem: run.gpx heat-map artifact contract + public serve route
status: complete
tags: [security, privacy, non-attributability, data-quality, gap-closure, tdd]
gap_closure: true
requirements: [HEAT-01, HEAT-03]

dependency_graph:
  requires:
    - "71-01 — heatmap-artifact.ts contract (assertNonAttributable, assembleHeatmapArtifact, normalizeTrack)"
    - "71-03 — verify-heatmap-artifact.mjs standalone verifier"
    - "71-05 — public/heatmap/[year]/route.ts serve path"
  provides:
    - "A runtime guard that actually inspects meta, coordinates and the root type (WR-01 closed)"
    - "A serve-path structural check — defence in depth on the way OUT (WR-02 closed)"
    - "A degeneracy filter at the single assembly point (WR-06 code half closed)"
    - "A verifier that FAILS degenerate geometry, pinned by a fourth self-test fixture"
    - "D-14 recorded in code at normalizeTrack so the accepted risk is not re-opened as a bug"
    - "Measured DC33 rebuild input for plan 71-15: 20 of 110 features degenerate, first index 0"
  affects:
    - "71-13 — the CDN comments in both files now name the ordered cache behaviour that plan adds"
    - "71-15 — MUST rebuild the DC33 artifact; the verifier now exits 1 against the live one"
    - "71-16 — the release that carries all of this to production"

tech_stack:
  added: []
  patterns:
    - "One spelling, two callers: META_KEYS ported verbatim from the standalone verifier into the runtime guard rather than re-invented"
    - "Guard on the way IN and on the way OUT — a type assertion is not a check"
    - "Self-test fixture per check, so a verifier cannot go vacuous silently"
    - "Accepted risks recorded at the code they constrain, with the reversal procedure named"

key_files:
  created: []
  modified:
    - "apps/run.gpx/webapp/src/lib/heatmap-artifact.ts"
    - "apps/run.gpx/webapp/src/lib/heatmap-artifact.test.ts"
    - "apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs"
    - "apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts"

decisions:
  - "assertNonAttributable checks the root type literal, a META_KEYS allowlist and the CONTENTS of geometry.coordinates; its docstring now also states honestly what it still does NOT check"
  - "The serve route runs the guard on the parsed object before echoing it; a failure is a 500, never a publish"
  - "A track whose surviving coordinates are all identical is not a run and is dropped at the single assembly point"
  - "The verifier's runCount > 0 liveness check is byte-untouched — the dc34 leg staying red is calendar-bound, not a bug to soften"
  - "D-14 (endpoint exposure) is an ACCEPTED RISK recorded in code; no trim helper, no precision change, no opt-in predicate"

metrics:
  duration: "~35m"
  completed: 2026-07-31
  tasks: 3
  commits: 4
  files_modified: 4
  tests_before: 303
  tests_after: 313
---

# Phase 71 Plan 10: Guard Widening, Degeneracy Filter & Serve-Path Validation Summary

The phase's one non-attributability chokepoint now inspects the field that actually carries
data, the assembler stops publishing runs that never moved, the serve route proves its own
output before it reaches the internet, and D-14 is written into the code it constrains.

## What Was Built

### Task 1 — Widen the guard, filter degenerate geometry, record D-14

`assertNonAttributable` walked every *key name* on the way to `geometry.coordinates` and then
never looked inside it. Three checks were added, in an order that keeps the error messages
useful:

| Check | Throws on | Names |
|-------|-----------|-------|
| root `type` | anything but the `FeatureCollection` literal | the actual value |
| `meta` shape | not a plain object (incl. absent, array, scalar) | `meta` |
| `meta` keys | any key outside `META_KEYS` | the offending key |
| `geometry.coordinates` | not an array | the feature index |
| each coordinate | not a 2-element array of two numbers | feature index + coordinate index |

`META_KEYS` (`year`, `generatedAt`, `runCount`, `totalKm`) is ported **verbatim** from
`scripts/verify-heatmap-artifact.mjs`, which had always been stricter than the runtime guard.
One spelling, two callers — deliberately not a second invention.

The docstring was rewritten to enumerate what the guard checks **and what it still does not**:
it does not range-check coordinates, it does not check for degeneracy, and per D-14 "carries no
identifier FIELDS" is not the same property as "not re-identifiable from geometry". The
previous docstring's claim outran its code, which is worse than an honest control because the
phase's own comments cite it as proof.

`assembleHeatmapArtifact` now drops a track whose surviving coordinates are all identical. The
filter is "never moved", not "is null island" — a run stuck at a real hotel entrance is just as
much not-a-run as one at `[0,0]`. It sits at the single assembly point, so it fixes both years
in source.

A block comment above `normalizeTrack` records **D-14**: the stride's first/last preservation
plus `COORD_PRECISION = 5` (~1.1 m) plus D-03's removal of the owner opt-in gate publishes every
con-day run's exact start and end point, unauthenticated, at a stable public URL, for runners
who never consented; Kurt reviewed exactly that on 2026-07-31 and accepted it; reversal requires
a new user decision, not a code-review comment.

### Task 2 — Teach the verifier to reject degenerate geometry

The `geometry is bounded LineString` check proved *bounds* and said nothing about whether a run
ever *moved* — which is how it certified a live artifact where 18 % of features are junk. After
the existing range walk it now fails when every coordinate equals the feature's first, naming
the index and the repeated coordinate. The pass detail gained `0 degenerate`, an audit-trail
line that would have read differently on the current live artifact.

A fourth `--selftest` fixture (`withDegenerateGeometry`) makes the check un-removable in silence.
This file has already gone vacuous once; the fixture is what stops a second time.

### Task 3 — Guard the serve path, tighten `?meta=1`, stop logging SDK errors

`JSON.parse(body) as HeatmapArtifact` was an **assertion, not a check**. Until this plan, the
only thing between a bad object and the open internet was the write-path guard inside the two
known builders — a manual object copy during an incident, a restore from backup, a future second
builder or a compromised uploads keypair would have been echoed unvalidated. The route now calls
`assertNonAttributable` on the parsed object and returns 500 on a throw. `artifact.meta` and
`artifact.features` are existence-checked separately: an object that parses to `{}` previously
returned a **200 with an empty body and a JSON content type**, which the studio then failed to
parse.

`?meta=` became exact equality against `"1"`, so `?meta=0` no longer projects meta.

No `console.*` call passes a caught error object any more. Node inspects enumerable own
properties and S3 exceptions carry request ids, response metadata and — for several shapes — the
bucket name and the key; that is exactly how a per-user `uploads/{userId}/...` key leaks the next
time this file is copied. Only a stable tag plus `error.name` is logged. The ordinary
unbuilt-year miss dropped from `error` to `warn` so an unauthenticated outsider cannot drive
CloudWatch error volume (and any alarm built on it) at will.

Both CDN comment blocks — here and above `MAX_TRACK_POINTS` — were rewritten. They claimed
caching that did not exist: the catch-all region behaviour uses the managed caching-**disabled**
policy, so `s-maxage` was decorative. They now name the dedicated ordered cache behaviour in
`infra/terraform/modules/cloudfront/v1.0.0/main.tf` (plan 71-13) and state the consequence of its
removal.

## Key Decisions

- **META_KEYS ported, not re-derived.** The standalone verifier was the stricter, older spelling.
  Two independent spellings of the same allowlist is how they drift apart.
- **The guard runs on both sides.** One structural walk per *origin* request, which the 71-13
  cache behaviour reduces to a handful per cache period. Cheap relative to publishing unchecked.
- **The `runCount > 0` liveness check is byte-untouched.** The dc34 leg of probe assertion 5 is
  red because zero con-day runs exist until 5 Aug 2026. Softening a verifier to turn a liveness
  gate green with no data behind it is the anti-pattern this phase already recorded.
- **D-14 lives in the code, not only in the planning docs.** A future reader hitting
  `normalizeTrack` sees the accepted risk and the reversal procedure at the point they would
  otherwise "fix" it.

## Requested Records

The plan asked for two numbers, both consumed by plan 71-15.

**(a) Pre-implementation test failure count: 8.**
Run against the unmodified `heatmap-artifact.ts`, the new tests reported `8 failed | 26 passed`.
The eight that were RED:

| # | Test |
|---|------|
| 1 | drops a null-island track that never moves |
| 2 | drops a never-moving track that is NOT at null island |
| 3 | drops only the degenerate track when mixed with real ones |
| 4 | throws when the root type is not FeatureCollection |
| 5 | throws when meta carries an unexpected key, naming it |
| 6 | throws when meta is absent or is not a plain object |
| 7 | throws when geometry.coordinates is not an array |
| 8 | throws on a malformed coordinate, naming the feature index |

The two remaining new tests (`keeps a genuine two-point track that actually moves`, `still
accepts a real multi-run artifact after the widening`) passed before *and* after by design —
they are the regression guards proving the new filter does not eat real runs and the widened
guard does not reject its own output.

**(b) Verifier against the live DC33 artifact.**

```
node scripts/verify-heatmap-artifact.mjs https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33
  ...
  FAIL  features[0] is degenerate: all 2 coordinates are [0, 0]
EXIT=1
```

| Field | Value |
|-------|-------|
| Exit code | **1** (was 0 before this plan) |
| First degenerate feature index | **0** |
| Degenerate features | **20 of 110** (18.2 %) |
| All at null island? | **yes** |
| Indices | 0,1,2,3,4,5,6,7,8,9,11,12,13,15,18,19,20,21,23,24 |
| Expected runCount after 71-15 rebuild | **110 → 90** (the served count is inflated 22 %) |

That non-zero exit against real production bytes is the proof the check works, and it is the
trigger for plan 71-15.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes were required; no architectural
decisions arose.

Two mechanical notes, neither a deviation in substance:

- `state.record-metric` and `state.add-decision` reject positional arguments in this GSD build
  and were re-run with named flags (`--phase/--plan/--duration`, `--summary`).
- `state.record-session` overwrote the rich `stopped_at` narrative with a one-liner; it was
  restored by hand with this plan's context, matching the convention the phase has been using.
- `state.advance-plan` errors on this project's STATE.md (no "Current Plan" line) — the
  pre-existing structural quirk 71-09 already recorded. `apps/run.gpx/webapp/tsconfig.tsbuildinfo`
  was reverted rather than committed; it is a tracked `tsc` cache and is build noise.

## Prohibitions Held

All four of the plan's prohibitions verified on comment-stripped source:

| Prohibition | Grep | Result |
|-------------|------|--------|
| No endpoint trimming | `trimEnds\|ENDPOINT_TRIM` | **0** |
| No precision change | `COORD_PRECISION = 4` → 0; `COORD_PRECISION = 5` → **1** | held |
| No opt-in predicate | `includeInAggregate` | **0** |
| No `runCount > 0` relaxation | `runCount <= 0` in the verifier | **1**, byte-identical |

The only diff line in the verifier mentioning `runCount` is a new comment; the check itself was
not touched.

The allowlist ordering security criterion was also confirmed by reading, not by count alone:
`isHeatmapYear` appears exactly twice (import at :5, guard call at :75) and the guard still runs
**before** `heatmapArtifactKey` constructs an S3 key at :82 from the untrusted URL segment.

## Verification

| # | Check | Result |
|---|-------|--------|
| 1 | `npx vitest run` (full suite) | **313 passed / 1 skipped** (baseline 303/1) — strictly higher, zero failures, no new skips |
| 2 | `npx tsc --noEmit` | **exit 0** |
| 3 | `node scripts/verify-heatmap-artifact.mjs --selftest` | **exit 0**, four fixtures (1 clean + 3 doctored incl. degeneracy) |
| 4 | Verifier vs live DC33 URL | **exit 1**, `features[0] is degenerate` |
| 5 | Lint gate | **not run** — eslint non-functional in both packages (D-71-A/C) |

Load-bearing proof for the new verifier check: the same 2-feature scratch artifact exits **0**
on the pre-change verifier (`git show HEAD~2:...`) and **1** on this one, naming `features[1]`.
The check is not decorative.

## Threat Model Dispositions

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-71-10-01 | mitigate | **done** — three checks added, each pinned by a RED-first test |
| T-71-10-02 | mitigate | **done** — guard on the serve path, 500 on failure |
| T-71-10-03 | **accept** | **recorded, not mitigated** — D-14 written at `normalizeTrack` with the residual property gap named and the reversal procedure stated |
| T-71-10-04 | mitigate | **done** — tag + `error.name` only, pinned by a negative grep |
| T-71-10-05 | mitigate | **done** — unbuilt-year miss demoted to `warn` |
| T-71-10-06 | mitigate | **partial by design** — code fixed both years; the live DC33 object is frozen in S3 until 71-15 rebuilds it |

## Known Stubs

None. No placeholder values, no unwired data sources, no TODO markers introduced.

## Handoff Notes

- **Nothing here is live.** Source only. Production still serves run.gpx v0.0.109 with the
  degenerate DC33 artifact and the un-widened guard until plan 71-16 releases.
- **Plan 71-15 has a hard input now:** the DC33 rebuild must drop 20 features (110 → 90) and the
  rebuilt artifact must pass `verify-heatmap-artifact.mjs` with exit 0. Today it exits 1.
- **Plan 71-13 is now cited by name in two files.** If that ordered cache behaviour is not added,
  both CDN comments become false again and the response-size bounds are mis-sized.
- **Do not re-litigate D-14.** It is user-locked and now recorded in the code.

## Self-Check: PASSED

All four modified files exist on disk. All four commits (`cfe22fa5`, `7a60b7a5`, `0ade85e8`,
`9549cf8c`) are present in `git log --all`.
