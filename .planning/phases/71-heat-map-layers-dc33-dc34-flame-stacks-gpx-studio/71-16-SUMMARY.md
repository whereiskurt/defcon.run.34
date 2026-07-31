---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 16
subsystem: ship (release + deploy + byte-identical production probe + visual evidence)
status: complete
gap_closure: true
tags: [heatmap, release, deploy, probe, regression-gate, d-13, heat-06, ship]
requirements: [HEAT-01, HEAT-02, HEAT-03, HEAT-04, HEAT-05, HEAT-06]

dependency_graph:
  requires:
    - "71-09 — D-13 line-opacity 0.25 -> 0.70 (gates probe assertion 19)"
    - "71-10 — degeneracy filter, tightened verifier, ?meta exact-match fix"
    - "71-11 — internal route constant-time compare + bare 404"
    - "71-12 — the 19-assertion probe and transcript-gap-pre.txt (8/19 baseline)"
    - "71-13 — CloudFront heat-map cache behaviour + gpx edge block (applied via PR #1146)"
    - "71-14 — de-collided schedules + timeout chain (applied via PR #1146)"
    - "71-15 — republished DC33 artifact, 110 -> 90 runs, 0 degenerate"
  provides:
    - "run.gpx v0.0.110 live in us-east-1 carrying the whole gap-closure set"
    - "transcript-gap-post.txt — 17/19 from the byte-identical probe (pre-fix was 8/19)"
    - "transcript-phase70-regression-gap.txt — dialog-shell probe 16/16, unmodified"
    - "controlled captures at the shipped 0.70 opacity showing a legible DC33 flame stack"
  affects:
    - "the dated 5-10 Aug 2026 re-probe todo — assertions 5 (dc34 leg) and 11 resolve there"

tech_stack:
  added: []
  patterns:
    - "Let CI perform the version bump from the dispatched ref — a manual bump on top double-bumps, because buildpub runs version.sh itself unless --skip-bump (which is prohibited)"
    - "Verify the roll by task-definition image + an independent BEHAVIOURAL sentinel, never by a workflow's exit status"
    - "When an app exposes no version over HTTP, say so and substitute stronger evidence rather than reporting an empty grep as a pass"
    - "Restore, don't overwrite, prior plans' committed screenshots when the regenerating script uses a capture method the current plan prohibits"

key_files:
  created:
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/transcript-gap-post.txt"
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/transcript-phase70-regression-gap.txt"
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/shot-dc33-SHIPPED-0.70-context.png"
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/shot-dc33-SHIPPED-0.70-detail.png"
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/shot-both-layers-SHIPPED-0.70-clean.png"
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/capture-log-gap.txt"
  modified:
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/SCREENSHOTS.md"
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/capture-heat-visual.cjs"
    - "apps/run.gpx/webapp/VERSION (v0.0.109 -> v0.0.110, bumped by CI on the Release PR, not by hand)"

decisions:
  - "71-16: the VERSION bump was left to CI. buildpub runs release-all.sh WITHOUT --skip-bump (which the plan prohibits), and version.sh increments from the DISPATCHED ref. The branch read v0.0.109, so CI produced exactly v0.0.110 — the orchestrator's stated target. A manual bump first would have double-bumped to v0.0.111 and contradicted that target"
  - "71-16: the plan's literal version check `curl https://gpx.defcon.run/use1/ | grep -oE 'v0\\.0\\.[0-9]+'` can never return a value — /use1/ is a 308 redirect stub and run.gpx exposes no version over HTTP at all. Reported as a defective acceptance command and met with strictly stronger evidence rather than silently scored as a pass"
  - "71-16: the three 71-08 screenshots the probe overwrites were RESTORED, not superseded. The probe shoots them at default zoom with the public layer groups ON — the exact capture method this plan's prohibitions forbid as a visual record — and 71-08's MISLEADING captions describe those specific bytes"
  - "71-16: capture-heat-visual.cjs was extended to force-hide layers the indeterminate master checkbox missed. It asserts nothing and gates nothing; heatmap-probe.cjs was left byte-identical"

metrics:
  duration: ~55m
  completed: 2026-07-31
  tasks: 5 (Task 5 accepted on evidence 2026-07-31; on-hardware visual check NOT performed)
  commits: 2 (plus CI's Release PR #1147)
  probe_score_pre: 8/19
  probe_score_post: 17/19
---

# Phase 71 Plan 16: Ship the Gap Closure — Summary

run.gpx **v0.0.110** is live in us-east-1 carrying all seven gap-closure plans. The
byte-identical 19-assertion probe went from **8/19 pre-fix to 17/19 post-deploy** — which
is the *perfect* pre-con score, not a shortfall. Phase 70's dialog-shell probe still scores
**16/16** unmodified. In the headless post-deploy captures the DC33 flame stack reads at the
shipped 0.70 opacity, with busy corridors visibly heavier than one-off spurs — but see the
Task 5 caveat below: that judgement has not been made by a human eye on real hardware.

**Assertion 16 — the blast-radius regression gate — stayed GREEN**, byte-identical to its
pre-fix record. The edge block did not catch meshtk's claim-link mint or run.auth's quota
family.

**Task 5 was accepted on the automated evidence, NOT on an on-hardware visual check.** See
the Task 5 section — three visual items remain unperformed and are recorded as residual.

## Ship record

| Step | Result |
|---|---|
| Release (buildpub, `--ref gsd/phase-71-heat-map-layers`) | [run 30659716961](https://github.com/whereiskurt/defcon.run.34/actions/runs/30659716961) — **success**, 3m52s |
| Version | `v0.0.109` → **`v0.0.110`**, bumped by CI |
| Image | `dc34-run-gpx-app:v0.0.110`, digest `sha256:8cc35f32…`, pushed 19:39:40Z |
| Release PR | [#1147](https://github.com/whereiskurt/defcon.run.34/pull/1147) "Release v20260731.1936" — cut from the phase ref and merged **by CI** at 19:39:44Z |
| Deploy (deploy.yml) | [run 30660029251](https://github.com/whereiskurt/defcon.run.34/actions/runs/30660029251) — **success**, `region=us-east-1`, `pr_number=skip`, `invalidate_cache=true` |
| Local `terragrunt apply` | **never invoked** |
| `--with-terragrunt` | **never passed** |
| `--skip-bump` | **never passed** |

`pr_number=skip` because buildpub had already merged Release PR #1147 — the same sequence
71-08 recorded. **The operator ran no merge command**; CI merged its own Release PR with
the admin token, which is what AGENTS.md Essential Rule 2 actually guards.

### The version bump was left to CI, deliberately

buildpub runs `release-all.sh` **without** `--skip-bump` (the plan prohibits that flag), and
`apps/version.sh` increments the VERSION file from the **dispatched ref**. The branch read
`v0.0.109`, so CI produced exactly `v0.0.110`.

Bumping by hand first would have made CI bump again — shipping **v0.0.111** and
contradicting the target version. The immutable-ECR hazard the instruction guards against
was checked directly instead, *before* dispatching:

```
aws ecr describe-images --repository-name dc34-run-gpx-app --image-ids imageTag=v0.0.110
  → ImageNotFoundException   (so v0.0.110 was free)
```

`origin/main:apps/run.gpx/webapp/VERSION` now reads **v0.0.110**.

## The roll was verified, not assumed — and the plan's check command is broken

**The plan's acceptance command cannot work for this app.** `curl -s
https://gpx.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'` returns **empty**, and not because
the deploy failed:

- `https://gpx.defcon.run/use1/` answers **HTTP 308** with `location: /use1` and a 6-byte
  body. It is a redirect stub, not the app.
- Following the redirect still yields no version string. run.gpx has **no**
  `NEXT_PUBLIC_APP_VERSION` anywhere in `webapp/src`, and `/api/health` returns
  `{"status":"healthy","service":"run.gpx","timestamp":…}` with no version field.

The command was written by analogy to run.human, which AGENTS.md documents and which does
expose a version. **run.gpx simply does not.** I polled it for 10 minutes before diagnosing
this; reporting that empty result as satisfied would have been a false verification of
exactly the kind T-71-16-04 exists to prevent. Two stronger, independent observations were
used instead.

**1. Infrastructure — the task actually rolled.**

| Field | Value |
|---|---|
| Service | `run-gpx-use1` on cluster `app-use1-dc34` |
| Deployments | **exactly one**, `status=PRIMARY` (no old task draining) |
| Task definition | `run-gpx-use1-dc34:**200**` (was `:199`) |
| Image on :200 | `dc34-run-gpx-app:**v0.0.110**` |
| Image on :199 | `dc34-run-gpx-app:v0.0.109` |
| Rollout | `COMPLETED`, running 1 / desired 1 |

**2. Behavioural — only the new code can produce this.** 71-15 predicted the exact
sentinel: `?meta=0` was returning the 86-byte meta projection because 71-10's exact-match
fix was source-only and undeployed.

| URL | Pre-deploy | Post-deploy |
|---|---|---|
| `…/heatmap/dc33?meta=0` | 86-byte meta projection | **439 858 bytes, full FeatureCollection** |
| `…/heatmap/dc33?meta=1` | 86-byte projection | 86-byte projection (unchanged, correct) |

This is independent of the AWS control plane and of CI's exit status. It is a behaviour
only the v0.0.110 image can produce.

A third, in-browser confirmation arrived during Task 4 — the live map object reports
`heatmap-dc33: opacity=0.7`, which is 71-09's D-13 change and cannot exist on v0.0.109.

## Quality gates (Task 1)

| Gate | Baseline | Result |
|---|---|---|
| `npx vitest run` | 303 passed / 1 skipped | **331 passed / 1 skipped** (35 files passed, 1 skipped) — strictly higher, 0 failures, skipped unchanged |
| `npx tsc --noEmit` | exit 0 | **exit 0** |
| `svelte-check` | 26 counted + 4 env-dependent (D-71-E) = 30 raw `Error:` lines | **30 raw `Error:` lines** — summary "26 errors and 1 warning in 12 files" plus the 4 `PUBLIC_MAPBOX_TOKEN` env errors. **Delta 0** |
| `build-frontend.sh` | exit 0 | **exit 0** |
| `verify-heatmap-artifact.mjs --selftest` | exit 0 | **exit 0** — 4 fixtures (1 clean accepted, 3 doctored rejected) |
| `terraform fmt -check` | clean | **exit 0** on `modules/cloudfront/v1.0.0` and `modules/heatmap-scheduler/v1.0.0` |

**Zero svelte-check diagnostics mention any heat-map file** (`grep -icE
"heatmap|heat-map|HeatMap"` over the output → **0**). The 12 files carrying errors are the
same pre-existing set: sheet-portal, DialogShell, Map.svelte, mapillary, utils, etc.

eslint and prettier were **not** run, per the plan: both are non-functional repo-wide
(D-71-A/C) or carry a pre-existing baseline failure on an untouched studio file (D-71-D).

Node 22.12.0 (`nvm use 22.12.0`) for every script invocation.

## The probe — 8/19 → 17/19

**The script is byte-identical to the one that produced the pre transcript.** Proven before
running it, and re-checked after:

```
git diff --stat 64958740..HEAD -- heatmap-probe.cjs   → empty
sha256(committed at 64958740) = 0b294c0881e21ee5138b947df5a568062022a5b11d4ecaf4d525224aa2cd00a2
sha256(working tree)          = 0b294c0881e21ee5138b947df5a568062022a5b11d4ecaf4d525224aa2cd00a2
last commit touching it       = f6aeb9ac (71-12 Task 2 — before the pre transcript)
```

### Per-assertion pre/post

| # | Pre (8/19, v0.0.109) | Post (17/19, v0.0.110) | Attributable to |
|---|---|---|---|
| 1 | **FAIL** 4× `Miss`, `edge-hits=0/3` | **PASS** `edge-hits=3/3`, `s-maxage=900` | 71-13 |
| 2 | **FAIL** same on the 441 779-byte artifact | **PASS** `edge-hits=3/3`, bytes **439 858** | 71-13 |
| 3 | PASS | **PASS** dc32 → 404, allowlist holds | — |
| 4 | PASS | **PASS** 81 bytes, exact key set | — |
| 5 | **FAIL** *both* legs | **FAIL** — dc33 leg now exit 0; **dc34 leg** `meta.runCount is 0, expected > 0` | dc33 leg: 71-15. **dc34 leg calendar-bound** |
| 6 | PASS | **PASS** `generatedAt` exact, `runCount=90 (== summary 90)` | both sides moved together in 71-15 |
| 7 | PASS | **PASS** dc34 artifact age 1.40 h | — |
| 8 | **FAIL** no marker, body `{"error":"Forbidden"}` | **PASS** `404`, `x-dc34-edge-block="1"`, **`body=""`** | 71-13 + 71-11 |
| 9 | PASS | **PASS** section **#5 of 5**, rows `🔥 DC34 — live \| 🔥 DC33 — the classic` | — |
| 10 | PASS | **PASS** stamp `"1h ago"`; hint now ends `· no runs yet — this layer fills in during the con` | 71-09 (IN-04 honest empty row) |
| 11 | **FAIL** dc34 layer absent | **FAIL** `dc34 feature count is 0` | **calendar-bound** |
| 12 | PASS | **PASS** `meta=2, bare-before=0`, dc34 fetched once, dc33 never | — |
| 13 | **FAIL** live daily was top-of-hour | **PASS** `daily=cron(20 4 * * ? *)`, hourly `cron(0 * 5-10 8 ? 2026)`, both ENABLED, `America/Los_Angeles` | 71-14 |
| 14 | **FAIL** neither URL served from the edge | **PASS** bare 439 858 B `hit=true`, `?meta=1` 86 B `hit=true` | 71-13 |
| 15 | **FAIL** all 6 paths lacked the marker | **PASS** 6 paths, all non-2xx, **all** carrying `x-dc34-edge-block=1` | 71-13 |
| 16 | **PASS** (must stay) | **PASS** — mint `405`, quota `401`, **neither carrying the marker** | **held** |
| 17 | **FAIL** 20 of 110 degenerate | **PASS** **0 of 90** degenerate | 71-15 |
| 18 | **FAIL** both minute fields `"0"` | **PASS** hourly minute `"0"`, daily minute `"20"` | 71-14 |
| 19 | **FAIL** live `line-opacity=0.25` | **PASS** `line-opacity=0.7` | 71-09 |

**Every expected transition landed.** 1, 2, 8, 13, 14, 15, 17, 18 and 19 all flipped red →
green. Nothing flipped green → red. No assertion deviated from 71-12's predicted map.

### Assertion 16 held — byte-identical to the pre-fix record

This was the stop-the-line gate, so it is quoted in full rather than summarised:

```
run.human's meshtk claim-link mint (MESHTK_RUN_INTERNAL_URL): status=405 x-dc34-edge-block=(absent)
run.auth's internal quota family:                             status=401 x-dc34-edge-block=(absent)
PASS  16. REGRESSION GATE — the edge block does NOT reach run.human or run.auth internal paths
```

Both status codes and both `(absent)` markers are identical to the pre-fix transcript. The
71-13 edge block is scoped to the gpx distribution's internal family and did not widen onto
the con-critical CTF flow.

### The two remaining reds, restated honestly

**Neither is a defect, and nothing was softened to hide them.**

- **Assertion 5 (dc34 leg)** — `verify-heatmap-artifact.mjs` requires `meta.runCount > 0`.
  The dc33 leg now passes (71-15). The dc34 leg fails because the DC34 artifact is
  structurally valid, served 200, and contains **zero features**.
- **Assertion 11** — `heatmap-layer.ts`'s `isFeatureCollection()` gate requires
  `features.length > 0`, a deliberate untrusted-input control (T-71-21), so the
  `heatmap-dc34` layer is never created.

One cause: **zero run rows carry a `conDay`, because DEF CON 34 is 2026-08-05..10 and today
is 2026-07-31.** No synthetic data was injected, the DC34 row was not hidden, and neither
assertion was weakened. **17/19 is the perfect pre-con score**, exactly as 71-12 predicted.
Both resolve on their own during the con.

`grep -c "pk\."` → **0** on both transcripts; `grep -c "eyJ"` → **0**.

## Phase 70 regression — 16/16, with its known weakness restated

`70-06-probes/dialog-shell-probe.cjs` re-run **unmodified** (`git diff 4ea0f34e..HEAD` on
the script is empty): **`RESULT: 16/16`**, zero FAIL lines →
`transcript-phase70-regression-gap.txt`.

**16/16 is necessary but NOT sufficient, and should not be cited as a clean bill.** Phase
70's own retrospective recorded that **two of that probe's assertions do not fail closed** —
they can pass vacuously rather than going red on an unresolvable condition. So this result
rules out the regressions the other fourteen assertions cover; it does not positively prove
the dialog subtree is untouched by 71-09's changes. Stating that plainly is the point.

Phase 70's twelve committed screenshots were regenerated by the re-run and **restored**;
all twelve verified byte-identical to their committed bytes afterwards.

## Visual evidence — the DC33 stack is finally legible

Live paint values, read off the map object during the capture:

```
heatmap-dc33: visibility=visible color=#ff8c00 opacity=0.7 width=3
heatmap-dc34: visibility=visible color=#ff0000 opacity=0.7 width=3
```

Three new captures, named so they cannot be confused with the pre-fix set:

| File | Zoom | What it shows |
|---|---|---|
| `shot-dc33-SHIPPED-0.70-context.png` | z12.6 | The Strip spine from Sahara to Luxor, the LVCC / Convention Center block, Paradise Rd and E Harmon all read as continuous orange; one-off spurs are visibly lighter |
| `shot-dc33-SHIPPED-0.70-detail.png` | z14.2 | **The money shot.** S Las Vegas Blvd is a thick bundle of many overlapping translucent strokes; the LVCC Loop and Westgate / Resorts World block are heavy; single-run spurs resolve as one thin stroke |
| `shot-both-layers-SHIPPED-0.70-clean.png` | z12.6 | Both rows ON. Pixel-for-pixel the same scene as the DC33-only shot, because DC34 draws nothing |

**I opened all three and describe what is actually there**: the density gradient reads —
corridors used by many runs are visibly heavier than spurs used by one. This is the effect
`shot-dc33-DIAG-0.70-legible.png` predicted at runtime and `shot-dc33-SHIPPED-0.25-invisible.png`
could not deliver. Same camera, same zoom, same geography, same headless environment; the
only variable is the shipped opacity.

The frame is genuinely clean — the capture's own output:

```
non-basemap layers still visible : heatmap-dc33
```

Exactly one. **DC34 draws nothing for calendar reasons, not render reasons**, and
`SCREENSHOTS.md` says so plainly along with the fact that no synthetic data was injected,
and that these are headless swiftshader captures — which is why Task 5 asks a human.

### Hotspot re-derived from the republished artifact

71-15 changed the artifact, so the camera was re-checked against the **new live bytes**
rather than inherited:

| Quantity | Value |
|---|---|
| Live artifact | 90 runs, **19 961** coordinates (was 20 001 — exactly the 40 coords of the 20 removed features) |
| Peak cell | lon `[-115.170, -115.165)` × lat `[36.125, 36.130)` |
| Points in the peak cell | **1 333** |
| Runs through it | **40 of 90** |
| Camera used | `-115.163, 36.127` — **unchanged**, 408 m from the peak |
| Coverage at z12.6 | 14 816 of 19 961 coords (74.2%), **69 of 90 runs** |
| Coverage at z14.2 | 13 154 coords (65.9%), **67 of 90 runs** |

Moving the camera to the true peak changes coverage by **5 coordinates and zero runs**, so
it was left unchanged — keeping it identical is what makes the 0.25/0.70 pair a controlled
comparison. The peak is unmoved by the republish because every removed feature was a
zero-length line at null island.

## The screenshot decision (made deliberately)

Running the probe overwrites three of 71-08's committed screenshots via assertion 11's
`parkAndShoot` helper. **I restored them** (verified byte-identical to their committed
hashes afterwards) rather than letting the post-deploy versions supersede them. Three
reasons:

1. `parkAndShoot` shoots at **default zoom with the public layer groups ON** — precisely
   the capture method this plan's own prohibitions forbid as a visual record. Committing
   those bytes as new evidence would enshrine the method the plan rejects.
2. 71-08 captioned those three ⚠️ **MISLEADING** with a specific explanation ("the
   colourful blob is the route groups, not the heat map"). That caption is accurate about
   *those specific bytes*; overwriting them would orphan a correct caption onto different
   images.
3. The legitimate post-deploy visual record is Task 4's controlled captures, which is what
   `SCREENSHOTS.md` now points at.

Same reasoning applied to `shot-both-layers-clean.png`: 71-08's copy was restored and the
new one saved alongside as `shot-both-layers-SHIPPED-0.70-clean.png`. This also matches
71-12's precedent, keeping the phase's visual archive stable across three plans.

## Deviations from Plan

**1. [Rule 3 — blocking] The plan's live-version check command cannot work for run.gpx**

- **Found during:** Task 2(d)
- **Issue:** `curl -s https://gpx.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'` returns
  empty. `/use1/` is an HTTP 308 redirect stub, and run.gpx exposes no version over HTTP
  by any route (no `NEXT_PUBLIC_APP_VERSION`, no version in `/api/health`). The command was
  written by analogy to run.human, which does expose one.
- **Resolution:** reported rather than scored as a pass. Substituted two independent and
  strictly stronger checks — the ECS task-definition image (`:200` → `v0.0.110`, single
  PRIMARY deployment, rollout COMPLETED) and a behavioural sentinel (`?meta=0` flipping
  from the 86-byte projection to the full 439 858-byte artifact, which only the new image
  can produce). This is the 71-08 methodology.
- **Files modified:** none.

**2. [Sequencing] The VERSION bump was performed by CI, not by hand**

- **Found during:** Task 2(a)
- **Issue:** the instruction to bump the file locally conflicts with the prohibition on
  `--skip-bump`. buildpub runs `version.sh` against the dispatched ref, so a manual bump
  would double-bump to v0.0.111 and miss the target version.
- **Resolution:** confirmed v0.0.110 was free in ECR *before* dispatching, then let CI
  bump v0.0.109 → v0.0.110. `origin/main` now reads v0.0.110. Same path 71-08 recorded.
- **Files modified:** `apps/run.gpx/webapp/VERSION`, by CI on Release PR #1147.

**3. [Rule 3 — blocking] The capture script left four layers and two markers drawn**

- **Found during:** Task 4
- **Issue:** the master-checkbox sweep only clicks a master reporting `checked`. A master
  in the **indeterminate** tri-state reports `false` and is skipped, so on the current
  five-section tree the first re-capture still drew `overpass` and three `dc34-rabbits-*`
  layers, plus two DOM marker beacons (which are not style layers at all) — violating the
  plan's explicit "every non-heat layer hidden" framing requirement.
- **Resolution:** `capture-heat-visual.cjs` now force-hides remaining non-heat layers
  through the map API and removes marker/popup DOM nodes. It asserts nothing and gates
  nothing. **`heatmap-probe.cjs` was not touched** — re-verified byte-identical afterwards.
- **Files modified:** `71-08-probes/capture-heat-visual.cjs`.

**4. [Cosmetic, carried from 71-12] Assertion 9 reports the Heat Map section as #5 of 5**

71-08 saw `#4 of 4` on a byte-identical image, so a fifth Map Layers section is appearing
from data rather than code. Assertion 9 asserts presence and rows, not ordinal, so it
passes. Unchanged and out of scope — recorded so it is not mistaken for a regression.

## Prohibitions honoured

| Prohibition | Evidence |
|---|---|
| No local `terragrunt apply` | none invoked; the ECS apply ran inside deploy.yml run 30660029251 |
| No `--with-terragrunt` | never passed |
| No `--skip-bump` | never passed; CI bumped normally, producing a new immutable tag |
| No edit to `heatmap-probe.cjs` | sha256 unchanged before **and** after the run; `git diff 64958740..HEAD` empty |
| No synthetic con-day data | assertions 5 (dc34) and 11 left red; no rows fabricated; DC34 row not hidden |
| No default-zoom capture with public layer groups on | the three probe shots were restored, not committed; the new record has exactly one non-basemap layer drawn |

## Threat model dispositions

| Threat ID | Disposition | Status |
|---|---|---|
| T-71-16-01 (probe edited after the deploy) | mitigate | **done** — byte-identity proven by sha256 and `git diff` before the run and re-checked after |
| T-71-16-02 (edge block catching a con-critical path) | mitigate | **done** — assertion 16 green and byte-identical to its pre-fix record; also raised for human spot-check in Task 5 |
| T-71-16-03 (mapbox token leaking into a committed artifact) | mitigate | **done** — `grep -c "pk\."` = 0 on both transcripts, the capture log and `SCREENSHOTS.md`; `grep -rl "pk\.eyJ"` over the probes dir = 0 files |
| T-71-16-04 (green CI read as a successful deploy) | mitigate | **done** — the workflow conclusion was explicitly **not** trusted; the defective version command was diagnosed rather than accepted, and the roll proven by task-def image plus a behavioural sentinel |
| T-71-16-05 (remaining reds absorbed into a headline score) | mitigate | **done** — full 19-row pre/post table above, with a written calendar-bound reason for each remaining red and an explicit statement that 17/19 is the ceiling before the con |

## Carried forward, not closed here

- **Probe assertions 5 (dc34 leg) and 11** — calendar-bound to 2026-08-05..10. Covered by
  the existing dated re-probe todo.
- **The DC34 hourly cadence has still never fired** and cannot before 5 August.
- **The three deferrals from 71-11, 71-13 and 71-14** (rate limiting on the internal route,
  the strava-sync comment, count-gating the VPC managed policy) remain post-con items.
- **IN-03** (an unreachable finite check in `polyline-decode.ts`) deliberately untouched.
- **D-71-A / D-71-B / D-71-D** remain open repo-wide tooling issues.

## Known Stubs

None introduced. The empty `dc34.json` is not a stub — it is the correct output of a
working builder over an empty input set, and the DC34 row is honest about it:
`0 runs · 0.0 km · no runs yet — this layer fills in during the con`.

## Threat Flags

None. This plan added no network endpoint, no auth path and no schema change; it released
surfaces plans 71-09 through 71-15 already enumerated.

## Task 5 — accepted on evidence; on-hardware check NOT performed

Kurt closed this gate on **2026-07-31**, choosing "close it out" over holding for the browser
check and over logging the items as a pending UAT. He did **not** report having opened the
studio. So this task is closed on the strength of the automated evidence — the 17/19 probe,
the Phase 70 16/16 regression, the ECS/ECR reads and the `?meta=0` behavioural sentinel — and
**not** on a human having looked at the map.

That distinction is load-bearing here. Every capture in this phase is headless Chromium on a
software rasteriser, and D-13 (0.25 → 0.70) is fundamentally a judgement about whether the
stack *reads as heat to a human eye*. The automated evidence proves the opacity shipped and
that the layer renders; it cannot prove the aesthetic call was right.

**Residual — three unperformed visual items, worth picking up before 2026-08-05:**

1. Open `https://gpx.defcon.run/use1/studio/app` in a real browser → Map Layers → turn OFF
   DEF CON 34 Routes / Rabbit Routes / User Check-ins → turn ON `🔥 DC33 — the classic` →
   zoom to the Strip. Confirm a visible orange stack with busy corridors heavier than spurs.
2. Confirm the DC33 hint bar reads ~90 runs (down from 110) with distance ~658.4 km.
3. Spot-check a ghost claim link. Assertion 16 gates it and is green both pre- and
   post-deploy, but a silent break would only surface during the con.

### Orchestrator-side confirmation of the ship (independent of the executor's own reads)

- ECS service `run-gpx-use1` on cluster `app-use1-dc34`: task definition
  `run-gpx-use1-dc34:200`, image
  `427284555693.dkr.ecr.us-east-1.amazonaws.com/dc34-run-gpx-app:v0.0.110`,
  `rolloutState: COMPLETED`, deployments **1** (no old task still draining), running 1 / desired 1.
- Behavioural sentinel post-deploy: `?meta=0` → **439,858 bytes** (86 bytes pre-deploy),
  bare → 439,858, `?meta=1` → 86 bytes carrying
  `{"year":"dc33","generatedAt":"2025-08-15T02:41:54.347Z","runCount":90,"totalKm":658.4}`.
  Only 71-10's exact-match fix produces the `?meta=0` result, so this is the strongest
  available proof the new image is genuinely serving.
- Assertion 16 re-checked independently after the deploy: mint → 405, quota → 401, neither
  carrying `x-dc34-edge-block`.

### Two process corrections this plan surfaced

1. **The plan's live-version command is wrong for run.gpx.**
   `curl https://gpx.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'` can never return a value —
   `/use1/` is a 308 stub and run.gpx exposes no version over HTTP at all; that is a
   run.human idiom. An empty grep scored as a pass is a false-verify. The working
   substitutes are the ECS task-definition read and the `?meta=0` sentinel above. Future
   run.gpx ship plans should use those and not re-derive this.
2. **Never hand-bump VERSION before a `buildpub` dispatch.** buildpub runs `version.sh` from
   the dispatched ref, so a manual bump double-bumps — this would have shipped v0.0.111. The
   orchestrator's dispatch brief incorrectly instructed a manual bump to v0.0.110; the
   executor overrode it and was right to. Correct sequence: confirm the target tag is free in
   ECR, dispatch buildpub, let CI perform the bump. Recorded so this file is not read as
   endorsing hand-bumping.

### Carried forward

`terragrunt-apply.yml` sets `concurrency: group: ${{ github.workflow }}-${{ github.ref }}`
with `cancel-in-progress: true` — keyed on the **ref**, not the `modules` scope. Two scoped
applies dispatched from the same ref cancel each other mid-flight on shared production
infrastructure. 71-13's and 71-14's applies were serialised deliberately for this reason.

## Self-Check: PASSED

- `71-08-probes/transcript-gap-post.txt` — FOUND, `RESULT: 17/19 assertions passed`
- `71-08-probes/transcript-phase70-regression-gap.txt` — FOUND, `RESULT: 16/16 assertions passed`
- `71-08-probes/shot-dc33-SHIPPED-0.70-context.png` — FOUND (754 470 B)
- `71-08-probes/shot-dc33-SHIPPED-0.70-detail.png` — FOUND (1 088 753 B)
- `71-08-probes/shot-both-layers-SHIPPED-0.70-clean.png` — FOUND (753 916 B)
- `71-08-probes/capture-log-gap.txt` — FOUND
- commit `d2d55225` — FOUND
- commit `60df8702` — FOUND
- `origin/main:apps/run.gpx/webapp/VERSION` = **v0.0.110**
- ECR `dc34-run-gpx-app:v0.0.110` — FOUND, digest `sha256:8cc35f32…`
- ECS `run-gpx-use1` task def `:200` → image `v0.0.110`, rollout COMPLETED
- no secret values in this file
