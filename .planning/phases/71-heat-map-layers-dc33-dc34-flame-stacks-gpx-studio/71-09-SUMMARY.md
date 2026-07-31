---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 09
subsystem: studio (gpx-studio heat layer paint + layer-class robustness)
tags: [heatmap, gpx-studio, d-13, wr-07, in-05, heat-04, heat-05, gap-closure]
status: complete
requires:
  - "71-05: HeatmapLayer, heatmapState, HEAT_PAINT, HEAT_STROKE, relativeStamp"
  - "71-06: HeatMap.svelte section + LayerControl wiring"
  - "71-08: the two controlled captures that measured 0.25 as invisible (gap #1)"
provides:
  - "HEAT_STROKE line-opacity 0.7 — the DC33/DC34 stacks are visible on the basemap at all"
  - "isFeatureCollection accepting an empty features array — a zero-run year is a real, buildable, empty layer"
  - "detail() zero-run branch — the DC34 row explains its own emptiness instead of reading as a broken checkbox"
  - "STYLE_READY_TIMEOUT_MS + a raced whenStyleReady() that always settles"
  - "remove() blanking heatmapState so the section's documented source of truth stays true across teardown"
affects:
  - "71-10..71-16: the remaining gap-closure plans inherit a visible layer; none of them re-touch HEAT_STROKE"
  - "the next release of run.gpx — this is source-only; nothing is live until the studio bundle ships"
tech-stack:
  added: []
  patterns:
    - "Race-and-resolve (never reject) for a readiness hint whose caller already tolerates a not-ready style"
    - "Separating a LIVENESS question ('has this year got data') from a STRUCTURAL one ('is this JSON a FeatureCollection') so the untrusted-input gate can stay tight while the empty case passes"
    - "Comment-stripped greps (grep -v '^\\s*[/*]') as acceptance criteria, so narrative history of a rejected value cannot satisfy a check that means to test live code"
key-files:
  created: []
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/HeatMap.svelte
decisions:
  - "71-09: the literal is written 0.7, not 0.70 — Prettier normalises trailing zeros in numeric literals, so 0.70 would have been silently rewritten to 0.7 by the repo's own formatter on the next touch. Same number; the comment states 0.70 explicitly and the acceptance grep targets 0.7, so both the human and the machine reading agree"
  - "71-09: whenStyleReady() races WITHOUT clearTimeout/off cleanup. A second resolve on a settled promise is a no-op, so the dangling <=10s timer and the one-shot idle listener are harmless; the cleanup variant needs a forward-referenced `timer` binding in the closure and buys nothing but a TS-inference risk. Simplicity-first per AGENTS.md"
  - "71-09: the rationale comment DELETES the addAggregate() 0.15/width-2 comparison rather than qualifying it. That comparison is the reasoning that produced the invisible render; leaving it in the file as a caveat invites the next reader to re-derive the same wrong number"
  - "71-09: available stays `meta !== null` and `shown` is untouched. Content-gating availability is the tempting fix WR-07 all but suggests, and it would have hidden the DC34 row, turning probe assertions 9/10/12 red and deleting the feature's pre-con visible promise"
metrics:
  duration: ~35 min
  completed: 2026-07-31
  tasks: 3
  files-modified: 2
  commits: 3
---

# Phase 71 Plan 09: Heat Paint D-13 + Empty-Year Honesty + Layer-Class Robustness Summary

Raised `HEAT_STROKE` line-opacity `0.25 → 0.7` per D-13 — the one change that makes the heat map visible to a runner at all — and, in the same two files, stopped an empty-but-valid year latching a dead checkbox (WR-07) and stopped `HeatmapLayer` wedging on teardown or a never-idle map (IN-05).

## What Was Built

### Task 1 — `HEAT_STROKE` opacity 0.25 → 0.7 (D-13) — commit `c618aed4`

The headline fix. At `0.25` the DC33 flame stack was not faint, it was perceptually absent over the Mapbox basemap, so the phase's own promise — "every run a translucent line, overlap = heat" — was false of the shipped build.

- `'line-opacity'` is now `0.7`. `'line-width': 3` untouched. **Neither `line-color` byte moved** — `git diff` over the whole plan shows zero `line-color` lines (verification step 3).
- The old JSDoc *argued for* 0.25 by citing `public-overlays.ts` `addAggregate()` at 0.15/width-2. That argument is falsified by measurement, so it was **deleted, not qualified** — it is exactly the reasoning that would talk the next reader into lowering the number again.
- The replacement rationale records, in prose: the value and Kurt's 2026-07-31 confirmation after the measured 0.25/0.45/0.70 sweep; that 0.25 was absent rather than faint, with data and render path ruled out first; the accepted trade-off (at 0.7 one line is fairly opaque, so overlap saturates sooner and the gradient is coarser — legibility beat fidelity); the known-and-deliberately-unfixed basemap-contrast factor with all three declined alternatives named (colour change, dark casing/under-stroke, runtime paint knob); and the discretion note that opacity tuning was always Claude's Discretion, so this is a tuning and not a reversal.

ROADMAP agreement confirmed rather than assumed: the Phase 71 `**Goal:**` line already states **70% opacity per D-13 (2026-07-31)** and `grep -c "25% opacity" .planning/ROADMAP.md` returns **0**.

### Task 2 — an empty-but-valid year is a real layer (WR-07) — commit `cf093213`

`GET /heatmap/dc34` currently returns a valid FeatureCollection with `features: []` — expected before the con. The old `isFeatureCollection` required `features.length > 0`, so `ensureGeometry` bailed **before** setting `built`, while `setVisible` persisted `visible: true` regardless. Net: the checkbox latched ON, painted nothing, said nothing, and re-downloaded the full artifact on every subsequent toggle and every page load.

- **(a)** Only the length clause was removed. The `type === 'FeatureCollection'` literal and `Array.isArray(features)` checks — the actual T-71-21 untrusted-input gate — are intact and pinned by acceptance greps. The JSDoc now states that this relaxes a **liveness** check, not a **structural** one, and that "has this year got data yet" is a different question from "is this JSON a FeatureCollection".
- With that clause gone, `ensureGeometry` runs to completion for an empty year: source added, layer added, `applyVisibility` called, `built[year] = true`. I read the whole method to confirm no other early-return fires for an empty artifact — the only remaining guards are `built[year]` (false on first entry) and `!res.ok` (a 200 for an existing empty artifact).
- **(b)** `detail()` gained a `runCount === 0` branch appending *"· no runs yet — this layer fills in during the con"*. The `Last built … · N runs · N.N km` prefix is preserved verbatim, so probe assertion 10 (hint must contain `runs` and a four-digit year) keeps passing.
- `available = meta !== null` and the `shown` derivation are **untouched** — see the decision above on why content-gating availability was rejected.

### Task 3 — `remove()` clears the store, `whenStyleReady()` always settles (IN-05) — commit `dd7f3e36`

- `remove()` now ends with `heatmapState.set(blankState())`. The store is documented as the HEAT MAP section's source of truth; a teardown that left it populated made that documentation false, with the section rendering rows for layers that no longer existed until the next `loadMeta()` landed.
- `whenStyleReady()` races `map.once('idle')` against a new module-level `STYLE_READY_TIMEOUT_MS = 10_000` and **resolves** on timeout. The comment states why resolving is deliberate: a map that never reaches idle previously left the promise unsettled forever, so the `await` in `ensureGeometry` never returned and that year's toggle never persisted; and rejecting would only relocate the bug, since `ensureGeometry`'s catch would swallow it and lose the layer just as silently. Proceeding early is safe because the downstream `getSource`/`getLayer` guards already tolerate a not-quite-ready style.
- No camera-moving call (`fitBounds`/`flyTo`/`easeTo`/`setCenter`/`jumpTo`) exists anywhere in the file — the Phase 70 restore landmine stays clean, verified by grep.

## Verification Performed

All 18 acceptance criteria across the three tasks pass. Every content grep was run comment-stripped where the plan specified it, so the new rationale prose (which legitimately contains "0.25", "reject" and "Last built") cannot green a check by accident.

| Gate | Result |
|------|--------|
| Task 1 — 6 criteria (opacity 0.7 ×1; width-3 ×1; `#ff8c00` ×1; `#ff0000` ×1; exactly one opacity VALUE assignment; stripped `0.25` ×0; `D-13` ×2; ROADMAP `25% opacity` ×0) | **PASS** |
| Task 2 — 8 criteria (`features.length > 0` ×0; `Array.isArray(o.features)` ×1; type literal ×1; `available…runCount` ×0; zero-run branch ×1; `Last built` ×1; `runs` ×2; `shown` derivation ×1) | **PASS** |
| Task 3 — 4 criteria (`heatmapState.set(blankState())` **exactly 1**, confirmed by reading to sit inside `remove()`; `setTimeout` ×1; `reject` ×0; camera calls ×0) | **PASS** |
| `npx svelte-check` — DELTA gate | **PASS — 0 diagnostics on either touched file** |
| `./apps/run.gpx/build-frontend.sh` | **PASS — exit 0** |
| `npx prettier --check` on both files | **PASS** |
| Diff re-read: no `line-color` byte moved | **PASS — 0 `line-color` lines in the plan's whole diff** |

**svelte-check delta, stated honestly.** The first (cold) run reported `26 errors, 1 warning in 12 files`; every run after reported `30 errors, 1 warning in 16 files`. That is not a regression — it is precisely the baseline the plan records as **26 + 4 env-dependent (D-71-E)**, and the extra files are `sheet-portal.svelte`, `map.ts`, `CustomLayers.svelte` and `LayerTreeNode.svelte`, none of which this plan touches or imports from. The gate that actually matters was run directly: `svelte-check --output machine | grep -cE "heatmap-layer|HeatMap.svelte"` returns **0** after every task.

**End-to-end confirmation beyond the plan's asks.** Because a source grep does not prove the bundle, I grepped the built studio chunk: `_app/immutable/chunks/CEUiPfUS.js` carries `"line-opacity":.7` alongside `#ff8c00` and `#ff0000`, plus the literal string `no runs yet — this layer fills in during the con`. (The neighbouring `.15` in the same chunk is `addAggregate`'s All-Runners layer, untouched and exactly as documented.) The working tree is clean after the build — output lands in a gitignored path.

## Deviations from Plan

**None — the plan executed exactly as written.** No deviation rule fired: no bug, no missing critical functionality, no blocker, no architectural question.

One implementation choice worth flagging as a *judgement call inside* the plan's latitude rather than a deviation: the plan's `must_haves` phrase the value as `0.70` while its acceptance grep targets `'line-opacity': 0.7`. I wrote the literal as `0.7` because the repo's own Prettier normalises numeric trailing zeros — `0.70` would have been rewritten on the next formatter touch, quietly turning a "shipped as 0.70" claim into a diff nobody authored. The comment states 0.70 in prose. `prettier --check` passes on the file as committed, so the source is now a formatter fixpoint.

## Known Stubs

None. No placeholder value, empty-return or TODO was introduced. The `runCount === 0` hint is not a stub — it is the specified product behaviour for a year that legitimately has no data yet, and it disappears on its own the moment the first con-day run lands.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change at a trust boundary. Each threat this plan's register anticipated is disposed of as planned:

- **T-71-09-01** (tampering via the `isFeatureCollection` relaxation) — *mitigated as designed.* Only the length clause went; both structural checks survive and are pinned by acceptance greps. No feature attribute is read by this module, so a tampered artifact still cannot reach the DOM.
- **T-71-09-02** (DoS via an unsettled `whenStyleReady` promise) — *mitigated as designed.* The named timeout resolves, so the caller always progresses.
- **T-71-09-03** (disclosure via the new hint text) — *accepted as designed.* The zero-run clause is a static string; it surfaces no field that `?meta=1` did not already publish.

## Prohibitions Honoured

All four of the plan's prohibitions were respected, each verified rather than asserted: no `HEAT_PAINT` colour changed (0 `line-color` lines in the diff); no casing/under-stroke, no second line layer, no runtime paint knob (exactly one `line-opacity` value assignment in comment-stripped source); no content-gating of `available` (the DC34 row still renders and still toggles, so probe assertions 9/10/12 stay green); no `fitBounds`/`flyTo`/`easeTo`/`setCenter`/`jumpTo` anywhere in the file.

## Follow-ups

- **Not live yet.** This plan is source-only. The visible fix reaches runners on the next `run.gpx` release + `deploy.yml` run; the current live build is v0.0.109 with the invisible 0.25 paint.
- **Re-probe after deploy.** 71-08's `shot-dc33-SHIPPED-0.25-invisible.png` should be re-captured with the same camera and the same non-heat layers hidden, to confirm production matches the 0.70 diagnostic capture rather than trusting the bundle grep.
- **WR-07's user-facing half is unfalsified until DC34 has data.** The empty-layer path is verified structurally (empty artifact builds, `built` latches, second toggle issues no fetch), but the hint's *wording* has not been read by a human on a live DC34 row. Worth a glance during Kurt's UAT.

## Self-Check: PASSED

- `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` — FOUND (modified)
- `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/HeatMap.svelte` — FOUND (modified)
- `.planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-09-SUMMARY.md` — FOUND
- Commit `c618aed4` — FOUND
- Commit `cf093213` — FOUND
- Commit `dd7f3e36` — FOUND
