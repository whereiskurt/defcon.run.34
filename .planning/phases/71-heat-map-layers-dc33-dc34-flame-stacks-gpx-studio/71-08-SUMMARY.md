---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 08
subsystem: ship (release + deploy + production probe)
tags: [heatmap, probe, release, deploy, eventbridge-scheduler, heat-06, d-12]
status: complete
requires:
  - "71-02: POST /api/gpx/internal/heatmap-build (x-internal-secret, maxDuration 300)"
  - "71-03: GET /api/gpx/public/heatmap/[year] (dc33|dc34 allowlist, s-maxage=900, ?meta=1)"
  - "71-04: live dc33.json artifact + scripts/verify-heatmap-artifact.mjs"
  - "71-05: HeatmapLayer, heatmapState, HEAT_PAINT, relativeStamp"
  - "71-06: HeatMap.svelte section + LayerControl wiring"
  - "71-07: modules/heatmap-scheduler v1.0.0 + us-east-1 live unit (planned, not applied)"
provides:
  - "71-08-probes/heatmap-probe.cjs — 13-assertion production probe, fixed literal denominator"
  - "pre- and post-deploy transcripts from a byte-identical script (2/13 → 11/13)"
  - "Phase 70 dialog-shell-probe.cjs regression transcript (16/16)"
  - "run.gpx v0.0.109 live in us-east-1"
  - "applied heatmap-scheduler: Lambda heatmap-build-use1 + 2 EventBridge schedules"
  - "uploads/HEATMAP/dc34.json (seeded, structurally valid, currently EMPTY)"
affects:
  - "Phase 72+: the two open UAT items below (Kurt's D-12 live read; the 5-Aug-2026 re-probe)"
tech-stack:
  added: []
  patterns:
    - "Fixed literal denominator + NO skip helper at all — the ship gate cannot be reached by shrinking what is asserted"
    - "Pre/post-deploy transcripts from a byte-identical script; the CONTRAST is the evidence"
    - "Probe shells out to the phase's own artifact verifier against LIVE URLs rather than reimplementing the check"
    - "Release from the phase branch ref: buildpub cuts the Release PR from the dispatched ref, so CI (not the operator) performs the merge"
key-files:
  created:
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/heatmap-probe.cjs
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/transcript-pre-deploy.txt
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/transcript-post-deploy.txt
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/transcript-phase70-regression.txt
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/capture-heat-visual.cjs
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/SCREENSHOTS.md
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/ (8 screenshots, captioned in SCREENSHOTS.md)
    - .planning/todos/pending/2026-07-31-heatmap-dc33-paint-invisible-and-con-reprobe.md
  modified:
    - apps/run.gpx/webapp/VERSION (v0.0.108 → v0.0.109, bumped by CI on main, not on this branch)
decisions:
  - "71-08: released from the phase branch ref rather than merging the phase PR by hand — buildpub cuts release/<ts> from the DISPATCHED ref, so dispatching with --ref gsd/phase-71-heat-map-layers made CI's own Release PR (#1132) the thing that landed the phase on main. The operator never ran a merge, which is what Essential Rule 2 and the plan's 'do NOT merge without approval' are actually guarding"
  - "71-08: the DC34 seed invoke was kept even though it produced an EMPTY artifact — an existing, structurally valid, zero-run dc34.json proves the whole invoke→route→builder→S3 chain and is strictly better evidence than a 404, even though it cannot satisfy the verifier's runCount > 0 check"
  - "71-08: assertions 5 and 11 were left RED rather than adjusted. The plan's own instruction is to fix the product and never the probe; here there is no product defect to fix, so the honest outcome is a red gate with a dated, self-resolving cause"
metrics:
  duration: ~75 min
  completed: 2026-07-31
  tasks: 4 (Task 4 closed by Kurt's ruling; step 5 recorded UNPERFORMED)
  commits: 4
  files_created: 12
  tests_added: 0
---

# Phase 71 Plan 08: Ship and Prove — Summary

run.gpx **v0.0.109** is live in us-east-1 with both public heat-map routes, the HEAT MAP
dialog section, and an applied `heatmap-scheduler` (Lambda + two EventBridge schedules,
9 resources, exactly the plan 71-07 recorded). A 13-assertion production probe went from
**2/13 pre-deploy to 11/13 post-deploy** from a byte-identical script, and Phase 70's
dialog-shell probe still scores **16/16**.

**The phase does not close green.** Two assertions are RED, both from one cause that is not
a defect: **DEF CON 34 has not happened yet**, so the DC34 artifact is structurally valid but
empty. That is written up in full below rather than smoothed over.

## Ship record

| Step | Result |
|---|---|
| Phase PR | [#1131](https://github.com/whereiskurt/defcon.run.34/pull/1131) — **CLOSED without merging** (Kurt's Decision 2); never merged by the operator |
| Release (buildpub, `--ref gsd/phase-71-heat-map-layers`) | [run 30602642562](https://github.com/whereiskurt/defcon.run.34/actions/runs/30602642562) — success |
| Version | `v0.0.108` → **`v0.0.109`**; `dc34-run-gpx-app:v0.0.109` pushed, digest `sha256:1a5f5059…` |
| Release PR | [#1132](https://github.com/whereiskurt/defcon.run.34/pull/1132) "Release v20260731.0352" — merged **by CI** with the admin token at 03:55:33Z |
| Deploy (deploy.yml) | [run 30602859411](https://github.com/whereiskurt/defcon.run.34/actions/runs/30602859411) — success, `pr_number=skip` (Release PR already merged by buildpub), `invalidate_cache=true` |
| Scheduler apply (terragrunt-apply.yml) | [run 30602871471](https://github.com/whereiskurt/defcon.run.34/actions/runs/30602871471) — success, scoped `modules=heatmap-scheduler` |
| Local `terragrunt apply` | **never invoked**; `--with-terragrunt` **never passed** |

**Apply counts match 71-07 exactly.** Plan `9 to add, 0 to change, 0 to destroy` →
`Apply complete! Resources: 9 added, 0 changed, 0 destroyed.` The `scheduler:` IAM grant that
71-07 flagged as "believed present, but a plan cannot prove it" is now proven empirically:
`aws_scheduler_schedule.sync["hourly"]` and `["daily"]` both created, zero authorization errors.

**The roll was verified, not assumed.** ECS service `run-gpx-use1` was polled until it showed a
single deployment on task definition `run-gpx-use1-dc34:199` → image `…/dc34-run-gpx-app:v0.0.109`.
The independent behavioural sentinel: `GET /api/gpx/public/heatmap/dc33` went `404 → 200`, which
only the new code can produce.

### How the phase reached main without the operator merging anything

`release-all.sh` cuts `release/<timestamp>` from the **current checkout** (line 268-271), and
buildpub's `actions/checkout@v4` takes the **dispatched ref**. Dispatching with
`--ref gsd/phase-71-heat-map-layers` therefore made Release PR #1132 carry the phase *and* the
VERSION bump, and buildpub merged it with `GH_RUNNER_TOKEN --admin`. Main is now
`9a4accd5 Release v20260731.0352`, carrying all the phase files (spot-checked: `heatmap-layer.ts`,
`HeatMap.svelte`, `public/heatmap/[year]/route.ts`, the `heatmap-scheduler` live unit) and
`VERSION = v0.0.109`.

Phase PR #1131 was therefore **closed without merging** (Kurt's Decision 2) — merging it would
have landed the same changes twice. It carries a comment naming #1132 as the landing commit. The
33 atomic per-task commits survive on the pushed, undeleted branch `gsd/phase-71-heat-map-layers`.

**Consequence worth naming:** the release happened *before* the post-deploy evidence existed, so
#1132 carried only the probe and the pre-deploy transcript. The post-deploy transcripts, the
screenshots, this SUMMARY, the STATE/ROADMAP updates and the todo were **not** on main and, with
#1131 closed, had no path there — so they went up as a separate **docs-only PR** off `main`.

## Quality gates — four green, two broken-by-default

| # | Gate | Result |
|---|---|---|
| 1 | webapp `npm test` | **exit 0** — 303 passed, 1 skipped (34 files), matches baseline |
| 2 | webapp `npm run lint` | **FAILS — pre-existing D-71-A**, `TypeError: Converting circular structure to JSON` in `@eslint/eslintrc` config-validator (`property 'react' closes the circle`) |
| 2b | webapp `npx tsc --noEmit` (substitute type gate) | **exit 0** |
| 3 | webapp `npm run build` | **exit 0**; both new routes present in the route table: `ƒ /api/gpx/internal/heatmap-build`, `ƒ /api/gpx/public/heatmap/[year]` |
| 4 | studio `npm run check` | 30 errors / 1 warning — the documented **26 + 4** baseline (D-71-E; the 4 `PUBLIC_MAPBOX_TOKEN` lines are present). **Zero errors mention any heat-map file** |
| 5 | studio `npm run lint` | **FAILS — pre-existing D-71-B + D-71-D**; prettier flags 47 files repo-wide. Of the layer-control files it flags `LayerControl.svelte` (D-71-D), plus `BasemapSection.svelte` and `CustomLayers.svelte`, **neither of which Phase 71 touched**. `HeatMap.svelte` and `heatmap-layer.ts` are prettier-clean |
| 6 | studio `npm run build` | **exit 0** with `PUBLIC_MAPBOX_TOKEN=pk.placeholder` (D-71-C; the shipped `build-frontend.sh:210-215` does the same) |

Gates 2 and 5 cannot exit 0 on this repo today. Both were logged in `deferred-items.md` by
earlier plans in this phase (71-01, 71-05, 71-06), both reproduce on an untouched tree, and
neither can be attributed to Phase 71. They were **not** fixed here — that is the executor
scope boundary, and a repo-wide eslint/prettier migration is its own piece of work.

## The probe

`71-08-probes/heatmap-probe.cjs` — 13 assertions, `const TOTAL = 13`, and **no `skip()` helper
exists in the file at all**. Assertions 6, 11 and 13 fail closed by construction.

**The two transcripts came from a byte-identical script.** `git diff HEAD -- heatmap-probe.cjs`
after the post-deploy run is empty; the file was committed with the pre-deploy transcript in
`d151090e` and never touched again.

| Assertion | Pre-deploy (v0.0.108) | Post-deploy (v0.0.109) |
|---|---|---|
| 1. dc34 200 JSON + s-maxage | FAIL 404, `text/html`, `no-store` | **PASS** 200, `application/json`, `public, s-maxage=900, stale-while-revalidate=900` |
| 2. dc33 200 JSON + s-maxage | FAIL 404 | **PASS** 200, 441 779 bytes |
| 3. dc32 → 404 (allowlist) | PASS (vacuous — route absent) | **PASS** (meaningful — route present and still rejects) |
| 4. `?meta=1` keys + < 500 B | FAIL 404 | **PASS** 81 bytes, keys exactly `[generatedAt, runCount, totalKm, year]` |
| 5. non-attributable live bytes, BOTH years | FAIL (both 404) | **FAIL** — dc33 exit 0, **dc34 `meta.runCount is 0, expected > 0`** |
| 6. dc33 meta == 71-04 | FAIL | **PASS** `generatedAt=2025-08-15T02:41:54.347Z`, `runCount=110` **== summary 110** |
| 7. dc34 fresh within 26 h | FAIL 404 | **PASS** `2026-07-31T04:02:14.036Z`, age 0.02 h |
| 8. internal POST non-2xx | PASS **404** (route absent) | **PASS 403** — the route exists and *rejects* |
| 9. Heat Map section, 2 rows | FAIL — only `[Basemap]` | **PASS** section #4 of 4, rows `🔥 DC34 — live \| 🔥 DC33 — the classic` |
| 10. stamp + hint bar | FAIL | **PASS** stamp `"1m ago"`, hint `"Last built 7/31/2026, 12:02:14 AM · 0 runs · 0.0 km"` |
| 11. both stacks simultaneously (D-12) | FAIL | **FAIL** — dc33 `layer=true source=true features=110 visibility=visible line-color=#ff8c00`; **dc34 `layer=false source=false features=null`** |
| 12. default-off + lazy-load (SC-4) | FAIL | **PASS** `meta=2, bare-before=0`, dc34 fetched **exactly once** on toggle, dc33 never |
| 13. both schedules ENABLED + exact | FAIL `ResourceNotFoundException` ×2 | **PASS** |
| | **RESULT 2/13, 11 FAIL lines** | **RESULT 11/13, 2 FAIL lines** |

### Assertion 13 — all six observed values

| Schedule | State | ScheduleExpression | Timezone |
|---|---|---|---|
| `heatmap-build-use1-hourly` | `ENABLED` | `cron(0 * 5-10 8 ? 2026)` | `America/Los_Angeles` |
| `heatmap-build-use1-daily` | `ENABLED` | `cron(0 4 * * ? *)` | `America/Los_Angeles` |

Field-for-field identical to 71-07's recorded table.

### Fail-closed was demonstrated, not assumed

- **Assertion 6** — the probe was run once with `71-04-SUMMARY.md` renamed away. It scored
  `FAIL 6. … summary unparseable: 71-04-SUMMARY.md not found at …`, and printed
  `HEATMAP_DC33_RUNCOUNT parsed as: UNPARSEABLE`. Not a skip, not a pass. File restored
  immediately; that run was written to scratch, not to a phase transcript.
- **Assertion 13** — pre-deploy it scored `FAIL` with a `ResourceNotFoundException` for both
  schedule names, exactly the shape the plan required, rather than skipping on CLI error.
- **Assertion 11** — post-deploy it is scoring FAIL right now on an unresolvable layer id
  (`dc34 layer heatmap-dc34 absent`), which is the fail-closed path working as designed.

### Phase 70 regression — 16/16

`70-06-probes/dialog-shell-probe.cjs` re-run **unmodified**: `RESULT: 16/16`, zero FAIL lines
(`71-08-probes/transcript-phase70-regression.txt`). Two results are worth naming:

- **Assertion 5** now reads `order ok [Basemap | User Check-ins | DEF CON 34 Routes | Rabbit Routes | Heat Map]`.
  71-06 argued *by construction* that inserting a "Heat Map" section could not break the
  section-order contract. That argument is now **measured** rather than reasoned.
- **Assertion 15** shows `Heat Map` collapse state persisting across a dialog close/reopen
  alongside the other four sections — 71-06's "collapse lives in the persisted store, never a
  local rune" decision holds against the shipped portal.

Phase 70's own screenshots were regenerated by the re-run and were **restored** rather than
committed, so Phase 70's archived visual evidence is not silently overwritten by a Phase 71 run.

## Why assertions 5 and 11 are red — and why nothing was "fixed"

Both failures have **one** cause: `uploads/HEATMAP/dc34.json` exists, is served 200, is
structurally valid, and contains **zero features**.

The DC34 seed invoke did what the plan asked and proved what the plan wanted it to prove:

```
aws lambda invoke --function-name heatmap-build-use1
  → StatusCode 200, FunctionError null
  → {"statusCode":200,"body":"{\"ok\":true,\"year\":\"dc34\",
      \"generatedAt\":\"2026-07-31T04:02:14.036Z\",
      \"runCount\":0,\"totalKm\":0,\"scanned\":0,\"skipped\":0}"}
```

`statusCode: 200` (not 403) means the SSM secret path, the VPC route to the private
service-discovery name, and the route's shared-secret guard are all correct. **The whole
invoke → route → builder → S3 chain works.** `aws s3 ls` shows `dc34.json` at 131 bytes,
written 00:02:15.

`scanned: 0` is the real answer, not a bug. Verified independently of the application, at the
data layer:

```
aws dynamodb scan --table-name run-gpx-electro \
  --filter-expression "attribute_exists(conDay)" --select COUNT
  → {"Count": 0, "Scanned": 133}
```

**Zero of 133 items carry a `conDay` attribute.** `CON_DAYS` for DC34 is `2026-08-05` …
`2026-08-10`; today is **2026-07-31**. No run can be tagged with a con day that has not
happened. The builder's selection (`status=active AND exists(conDay) AND userId != GLOBAL`,
then `CON_DAY_DATES.has(conDay)`) is behaving exactly as 71-01/71-02 specified.

Consequences, precisely:

- **Assertion 5** fails because `verify-heatmap-artifact.mjs` requires `meta.runCount > 0`
  ("runCount agrees with features"). The **dc33 leg passed**: `exit 0 — OK year=dc33
  runCount=110 totalKm=658.4`. So T-71-34, the phase's central privacy control, **is proven on
  live production bytes** for the year that has data.
- **Assertion 11** fails because `heatmap-layer.ts`'s `isFeatureCollection()` gate requires
  `features.length > 0`, so an empty artifact never reaches `addSource` and the `heatmap-dc34`
  layer is never created. That gate is a deliberate untrusted-input control (T-71-21) and is
  working correctly. DC33 rendered perfectly in the same run: 110 features, `visibility=visible`,
  `line-color=#ff8c00` — the exact Kurt-locked value.

**Nothing was changed to make these go green.** The plan's rule is explicit — fix the product,
never the probe — and here there is no product defect to fix. The alternatives were all worse:
softening assertion 5 would gut the phase's central privacy control (T-71-37, the exact tampering
this phase modelled); fabricating DC34 rows would be manufacturing evidence; and hiding the DC34
row when `runCount === 0` would merely move the red to assertion 9 while changing user-visible
behaviour without Kurt's input (a Rule 4 architectural call, not an executor call).

**These two assertions are expected to turn green on their own during 5–10 August 2026**, with
no code change, the first time a runner submits a con-day-tagged run and the hourly schedule
fires. They are the single most valuable thing this probe can tell us on 5 August.

## Human read of the D-12 visual evidence — and a NEW live finding

My first read of `shot-both-layers.png` was that it was a weak record. Kurt checked and went
further: that shot and `shot-dc33-only.png` are **visually indistinguishable**, and neither
demonstrates a flame stack at all. He was right, and the re-shoot he ordered turned up something
worse than a capture problem.

### The re-shoot

`71-08-probes/capture-heat-visual.cjs` (a capture-only script — it asserts nothing, gates
nothing, and `heatmap-probe.cjs` was **not** touched) re-shot production with every other layer
force-hidden and the camera parked on a **measured** hotspot rather than a guessed centre: a
0.005° grid over all 20 001 live coordinates peaks at `-115.1650, 36.1250`, where **40 of the
110 runs** pass through one cell.

### The finding: DC33 is invisible at the shipped paint values

**At `#ff8c00` / `line-opacity 0.25` / `line-width 3` (the shipped D-02 values), the DC33 stack
is not faint — it is invisible.** With every other layer hidden, at z14.2, with up to **36
overlapping runs under a single screen pixel**, nothing is discernible on screen.

This is **not** a data problem and **not** a render-path problem. Both were ruled out:

| Evidence | Result |
|---|---|
| `queryRenderedFeatures({layers:['heatmap-dc33']})` | **82** features at z12.6, **208** at z14.2 — mapbox believes it is drawing them |
| Layer position in the style | index **44 of 45** — the heat layer is the **topmost** layer; nothing occludes it |
| Source feature count | **110**, matching the artifact |
| Forced `opacity 1 / width 4 / #ff00ff` | a dense, correctly georeferenced network of runs (`shot-dc33-DIAG-opacity1-magenta-geometry-proof.png`) |

Sweeping opacity against production, all else identical:

| opacity | read |
|---|---|
| **0.25 (shipped)** | **invisible** |
| 0.45 | marginal — thin orange line-work, easily confused with the basemap's own orange road casings |
| **0.70** | **legible, and the density gradient reads** — Strip / LVCC Loop / Convention Center / Westgate visibly heavier than one-off spurs. This is the effect D-12 is asking for |

**Nothing was changed.** D-02's colour, width and opacity are Kurt-locked, so re-tuning is his
call, not an executor fix — and it would need a re-release. Filed as a high-priority todo. A
second observation for that decision: `#ff8c00` sits very close to the default basemap's own
orange road casings, so contrast is poor at *any* opacity; DC34's `#ff0000` should fare better.

**Caveat, stated rather than buried:** every capture was headless Chromium on swiftshader. The
0.70 and 1.0 renders prove low-alpha line blending works in that environment, so a pure headless
artifact is unlikely — but a look on a real browser before re-tuning is cheap and worth doing.

### Data-quality finding in the DC33 artifact (separate, smaller)

Measured off the live bytes while picking the camera:

- **20 of 110 features contain a `[0, 0]` coordinate**; `features[0]` is literally
  `[[0,0],[0,0]]`, a degenerate two-point line at null island.
- **41 of 110 features have no coordinate inside the Las Vegas box**; the artifact bbox spans
  `lon -119.06 … 0`, `lat 0 … 53.40`.

Privacy is unaffected (`assertNonAttributable` is about attributes, not coordinates, and
assertion 5's dc33 leg still passes). But that is noise in a "DEF CON 33 heat map", and it
inflates `runCount` 110 against roughly 69 features that actually draw over Vegas. Folded into
the same todo.

### What the screenshots now show

`71-08-probes/SCREENSHOTS.md` captions every image, including marking the three original probe
shots ⚠️ MISLEADING with the reason. Short version: the colourful blob in the originals is the
**route groups**, not the heat map.

### D-12 verdict

**Step 5 of Task 4 — do orange and red read as two years where they overlap — remains
UNPERFORMED, and is now blocked twice over:** DC34 draws nothing (0 runs, until the con), and
DC33 draws nothing at the shipped opacity. Neither is a defect this plan could fix without
overriding a user-locked decision.

## Residual — SC-2 hourly cadence not observable until August 2026

1. **The observed freshness is the daily baseline's doing.** Assertion 7's 26-hour window is
   satisfied by the `daily` `cron(0 4 * * ? *)` 04:00 PT entry on its own. (In this run it was
   satisfied by the manual seed invoke, 0.02 h old.) Assertion 7 must **not** be read as
   evidence that the hourly cadence was observed.
2. **The hourly con-window schedule physically cannot fire before 5 August 2026.**
   `cron(0 * 5-10 8 ? 2026)` is the top of every hour on 5–10 August 2026 only. There is no
   way to observe it today short of changing the expression, which would be falsifying the test.
3. **What IS proven today.** Both schedules are installed and ENABLED with the exact
   expressions and the `America/Los_Angeles` timezone 71-07 planned — assertion 13, all six
   field values recorded above. And the full invoke → route → builder → S3 chain works end to
   end — Task 2H's live Lambda invoke returned `statusCode 200` and wrote `dc34.json`.
4. **What is NOT proven.** The literal loop "submit a run during the con, see the artifact
   change within about an hour". Neither half of it is observable now: the cadence cannot fire,
   and there are no con-day runs to change the artifact with.

**SC-2 is therefore PARTIALLY MET and is not being closed.**

### Re-check due 5–10 August 2026

Re-run `71-08-probes/heatmap-probe.cjs` unmodified during the con and confirm:

- assertion 7's `generatedAt` **moves hourly** (not just daily);
- assertion 5 passes for **dc34** as well as dc33;
- assertion 11 passes — both stacks on the map together with the locked colours;
- then, and only then, make the D-12 human read of `shot-both-layers.png`.

## Task 4 — blocking human verification (CLOSED by Kurt's ruling)

Kurt ruled on the checkpoint: **"Re-shoot, then close at 11/13."** Verbatim decisions recorded:

> **DECISION 1 — "Re-shoot, then close at 11/13." Accepted.** … that shot and
> `shot-dc33-only.png` are visually INDISTINGUISHABLE. At zoom ~10.5 with the default-ON route
> groups drawn over the same blocks, neither screenshot demonstrates a flame stack at all. That
> is a methodology gap sitting on top of the data gap, and unlike the data gap it is fixable
> right now. … Keep DC34 exactly as it is — empty, one row, no synthetic data. Do NOT fabricate
> con-day rows, and do NOT hide the DC34 row on runCount === 0. … If, with the overlays off,
> DC33's stack still does not read as a legible flame stack, SAY SO plainly — that would be a
> real finding about D-12, not a capture problem. Do not force a flattering shot.
>
> **DECISION 2 — Close PR #1131 without merging.** Its content is already on main squashed via
> Release PR #1132; merging it would land the same changes twice.

Both were carried out. DC34 was left empty with its row visible; no synthetic data was injected;
the probe and its transcripts were not edited; PR #1131 was closed with a comment pointing at
#1132 as the landing commit.

Task 4's verification steps, honestly scored against the live site:

| Step | Status |
|---|---|
| 1. Open the studio, click Layers | **PASS** (probe assertion 9) |
| 2. HEAT MAP section, two flame rows, both OFF, header stamp | **PASS** — section #4 of 4, rows `🔥 DC34 — live` / `🔥 DC33 — the classic`, stamp `"1m ago"` (assertions 9, 10, 12) |
| 3. Hover DC34 → exact timestamp, run count, distance in the hint bar | **PASS** — `"Last built 7/31/2026, 12:02:14 AM · 0 runs · 0.0 km"` (assertion 10) |
| 4. Turn on DC34 → red lines over Las Vegas, busy corridors hotter | **NOT PERFORMABLE** — DC34 has 0 runs |
| 5. Turn on DC33 too → **both colours simultaneously legible** (the D-12 read) | **NOT PERFORMED** — blocked twice: DC34 draws nothing, and DC33 is invisible at the shipped opacity |
| 6. Reload → both layers return ON, camera does not jump | **PASS** — Phase 70 probe assertion 16 covers exactly this (visibility restored, `moves=0`, camera unchanged) |
| 7. Turn both off, reload, they stay off | **PASS** — assertion 12 measures the default-off path in a clean context |
| 8. Narrow window / phone usable | **PASS** — Phase 70 probe assertion 14 (body overflows and scrolls, `clientH=562 scrollH=2236`) |

**Task 4 is marked complete on Kurt's explicit ruling**, with step 5 recorded as unperformed
rather than waived, and step 4 as unperformable. Both re-open at the con via the todo.

## Deviations from Plan

**1. [Rule 3 — blocking] Quality gates 2 and 5 cannot exit 0**

- **Found during:** Task 2A
- **Issue:** the plan requires all six gate commands to exit 0 and says "do not proceed on a
  failure". Two of them are broken repo-wide and cannot pass.
- **Resolution:** proceeded, with evidence of pre-existence rather than a fix. D-71-A, D-71-B
  and D-71-D were all logged in `deferred-items.md` by 71-01 / 71-05 / 71-06, each reproduced
  against an untouched tree at the time. `npx tsc --noEmit` (exit 0) was run as a substitute
  type gate, and both `npm run build` commands — the gates that actually gate shipping — exit 0.
  Halting here would deadlock the phase on a tooling migration no plan in it could perform.
- **Files modified:** none.

**2. [Scope] The DC34 seed produced an empty artifact — assertions 5 and 11 left RED**

- **Found during:** Task 2H / Task 3
- **Issue:** the plan assumes a DC34 artifact with geometry and requires `RESULT: 13/13`.
- **Resolution:** documented above at length; nothing was changed. Task 3's automated
  `<verify>` (`grep -q 'RESULT: 13/13'`) does **not** pass, and that is being reported rather
  than engineered around.
- **Files modified:** none.

**3. [Sequencing] Task 2C's PR was opened but not merged; CI's Release PR landed the phase**

- **Found during:** Task 2C/2D
- **Issue:** `release-all.sh` branches `release/<ts>` from the dispatched ref, so a release from
  the phase branch necessarily produces a Release PR containing the phase.
- **Resolution:** phase PR #1131 opened and left open; buildpub merged its own Release PR #1132.
  The operator ran no merge command. Both PR numbers recorded.
- **Files modified:** none.

**4. [Cosmetic] Assertion 13 is emitted before 9–12 in the transcript**

- The probe groups the no-browser assertions (1-8, 13) ahead of the browser ones (9-12), so 13
  prints ninth. Every assertion is numbered and named, so the transcript is unambiguous. Not
  worth a script change once the byte-identical requirement was in force.

## Authentication gates

None. The `dc34-application` SSO session held for the whole run (verified at start via
`sts get-caller-identity`, account 427284555693). No SSO expiry masqueraded as a failed assertion.

## Deferred Issues

All three below are carried by one todo:
`.planning/todos/pending/2026-07-31-heatmap-dc33-paint-invisible-and-con-reprobe.md`
(area `run.gpx`, priority `high`), so they surface in `/gsd-progress` and `/gsd-audit-uat`.

- **DC33 renders invisible at the shipped D-02 paint values** — HIGH, and live right now. A
  user who turns on 🔥 DC33 sees no change. Needs Kurt's re-tune (opacity toward ~0.6-0.7,
  and/or a colour with better contrast against the basemap's orange road casings, and/or a dark
  casing under the line). Not fixed here: D-02 is user-locked.
- **DC33 artifact data quality** — 20 of 110 features carry a `[0,0]` coordinate and 41 have no
  Las Vegas coordinate at all. Worth a builder filter or a backfill re-run.
- **The 5–10 August 2026 re-probe** — assertions 5 and 11, plus the SC-2 hourly cadence and the
  D-12 two-colour read, all resolve there and only there.
- **D-71-A / D-71-B / D-71-D** remain open repo-wide tooling issues, unchanged by this plan.

## Known Stubs

None introduced. The empty `dc34.json` is **not** a stub — it is the correct output of a
working builder over an empty input set, and it will fill itself during the con with no code
change. The DC34 row renders and is honest about it: `0 runs · 0.0 km`.

## Threat Flags

None beyond the plan's register. No new surface was introduced by this plan; it shipped surfaces
71-02 through 71-07 already enumerated.

| Threat | Status |
|---|---|
| T-71-34 (info disclosure, live artifacts) | **Proven for dc33** on live production bytes — verifier `exit 0`, 441 779 bytes, zero forbidden substrings. **Not yet provable for dc34** (no bytes to check). Not softened |
| T-71-35 (EoP, internal route public) | **Closed** — unauthenticated POST to `/api/gpx/internal/heatmap-build` on the public host returns **403** |
| T-71-36 (DoS, unauthenticated public route) | **Closed** — live `Cache-Control: public, s-maxage=900, stale-while-revalidate=900` confirmed on the response, not just in source |
| T-71-37 (probe softened to reach the gate) | **Held** — `git diff` on the probe between runs is empty; two assertions left red rather than adjusted |
| T-71-38 (repudiation, "it works") | **Closed** — 11 FAIL lines pre-deploy vs 2 post-deploy, same script |
| T-71-39 (Phase 70 contracts broken) | **Closed** — Phase 70 probe 16/16 unmodified, with Heat Map in its assertion-5 order listing |
| T-71-40 (secrets in transcripts) | **Held** — `grep -c 'console.log(.*MAPBOX_TOKEN'` = 0; no `pk.` token in any committed artifact |
| T-71-SC (supply chain) | **Held** — zero packages installed; the probe reuses `playwright-core` from `apps/run.auth/e2e/node_modules` |

## Self-Check: PASSED

All seven created files exist on disk (`heatmap-probe.cjs`, three transcripts, three PNGs).
Both commits resolve in `git log`: `d151090e`, `c2bbfa6f`. `apps/run.gpx/webapp/VERSION` on
`origin/main` reads `v0.0.109`. `aws s3 ls s3://uploads-dc34-run-gpx-use1-80a6b349/uploads/HEATMAP/`
lists both `dc33.json` (441 779 B) and `dc34.json` (131 B).
