# Phase 71 — heat-map visual evidence, captioned

Read this before trusting any image in this directory. Two of the originals are
misleading and are kept only because deleting evidence is worse than labelling it.

**This index now covers two eras.** Filenames carry the `line-opacity` that was LIVE when
the shot was taken, so the two cannot be confused:

- **`SHIPPED-0.25`** — the pre-fix era, run.gpx **v0.0.109**. The stack was invisible.
- **`SHIPPED-0.70`** — the post-fix era, run.gpx **v0.0.110** (plan 71-16). D-13 shipped.

`DIAG` shots are neither: they were produced by changing `line-opacity` **in the browser
at runtime for diagnosis only** while 0.25 was still live. They are what motivated D-13.

## The finding, and its resolution

**Then (v0.0.109).** At the original values (`line-color #ff8c00`, `line-opacity 0.25`,
`line-width 3`) the DC33 stack was **not faint — it was invisible**, even with every other
layer hidden and 36 overlapping runs under a single screen pixel.

**Now (v0.0.110).** D-13 raised `line-opacity` to **0.70**; colour and width are unchanged.
The stack is legible in production, and the density gradient reads. Paint values read back
off the live map object during the capture:

```
heatmap-dc33: visibility=visible color=#ff8c00 opacity=0.7 width=3
heatmap-dc34: visibility=visible color=#ff0000 opacity=0.7 width=3
```

### Side-by-side — the whole point of this phase

| Before | After |
|---|---|
| `shot-dc33-SHIPPED-0.25-invisible.png` | **`shot-dc33-SHIPPED-0.70-detail.png`** |
| v0.0.109, opacity 0.25, z14.2, same hotspot | v0.0.110, opacity 0.70, z14.2, same hotspot |
| Nothing discernible | Corridors read; busy corridors visibly heavier than spurs |

Same camera, same zoom, same artifact geography, same headless environment. **The only
variable is the shipped opacity.**

## The post-deploy captures (v0.0.110, 2026-07-31)

| File | Capture conditions | What it actually shows |
|---|---|---|
| `shot-dc33-SHIPPED-0.70-context.png` | **Live shipped 0.70.** DC33 only. Every non-heat layer hidden and both DOM marker beacons removed. z12.6 on the measured hotspot | **Corridor context.** The Strip spine from Sahara down to Luxor, the LVCC / Convention Center block, Paradise Rd and E Harmon all read as continuous orange. Thin one-off spurs into side streets are visibly lighter than the corridors |
| `shot-dc33-SHIPPED-0.70-detail.png` | Same, z14.2 | **Individual-line detail — the money shot.** S Las Vegas Blvd is a thick bundle of many overlapping translucent strokes; the LVCC Loop and the Westgate / Resorts World block are heavy; single-run spurs resolve as one thin stroke. This is "overlap is heat" being legible, which is exactly what D-12 asked for and what 0.25 could not deliver |
| `shot-both-layers-SHIPPED-0.70-clean.png` | Both heat rows ON, z12.6 | **The honest D-12 record as of today.** It is pixel-for-pixel the same scene as the DC33-only context shot, because DC34 contributes nothing. See the DC34 note below |

Confirmation that the frame really is clean — printed by the capture run itself:

```
force-hidden (master checkbox missed) : overpass, dc34-rabbits-clusters,
  dc34-rabbits-cluster-count, dc34-rabbits-pins,
  (dom) dc34-coffee-beacon ..., (dom) dc34-spot-beacon ...
non-basemap layers still visible : heatmap-dc33
```

Exactly one non-basemap layer is drawn. Full run log: `capture-log-gap.txt`.

## DC34 draws nothing — and that is not a render gap

**DC34 is empty for calendar reasons, not rendering reasons.** DEF CON 34 is
**2026-08-05..10** and these captures were taken on **2026-07-31**. Zero run rows carry a
`conDay`, so the DC34 artifact is structurally valid, served 200, and contains zero
features. `heatmap-layer.ts`'s `isFeatureCollection()` gate requires
`features.length > 0`, so the `heatmap-dc34` layer is never created.

**No synthetic data was injected and the DC34 row was not hidden.** Both were offered and
declined. Probe assertions 5 (dc34 leg) and 11 are red for this one reason and were left
red rather than softened. They resolve on their own during the con.

## Known limitation — these are headless captures

Every image here was taken by **headless Chromium on the swiftshader software
rasteriser**, not on real hardware or a real GPU. The 0.70 and opacity-1 renders prove
low-alpha line blending works in that environment, so a pure headless artifact is
unlikely — but it is not the same as a human looking at a real browser. That is precisely
why plan 71-16 Task 5 is a **blocking human verification on real hardware** and does not
treat these captures as sufficient on their own.

## The pre-fix captures (v0.0.109) — kept for contrast

| File | Capture conditions | What it actually shows |
|---|---|---|
| `shot-dc33-SHIPPED-0.25-invisible.png` | **Then-shipped values (v0.0.109).** All non-heat layers force-hidden. z14.2 on the measured density hotspot | **Nothing.** No orange stack is discernible anywhere. This was the honest record of what a user saw **before v0.0.110**. Compare directly against `shot-dc33-SHIPPED-0.70-detail.png` — same camera, same zoom |
| `shot-dc33-DIAG-0.45-marginal.png` | opacity raised to **0.45** at runtime, otherwise identical | Visible but marginal — reads as thin orange line-work easily confused with the basemap's own orange road casings |
| `shot-dc33-DIAG-0.70-legible.png` | opacity raised to **0.70** at runtime, otherwise identical | **The effect D-12 is asking for.** The Strip corridor, LVCC Loop, Convention Center and Westgate all read, and busy corridors are visibly heavier than one-off spurs — density gradient is legible |
| `shot-dc33-DIAG-opacity1-magenta-geometry-proof.png` | opacity 1.0, width 4, colour forced `#ff00ff` | Proof the **data and the render path are fine**: a dense, correctly-georeferenced network of runs. Rules out "bad geometry" and "layer not painting" as explanations |
| `shot-both-layers-clean.png` | **v0.0.109 / 0.25**, both rows ON, overlays off, z12.6 | Both heat rows enabled. DC34 contributes **nothing** — it has 0 runs. Not a rendering fault. Superseded by `shot-both-layers-SHIPPED-0.70-clean.png`; the original bytes are kept unchanged |
| `shot-both-layers.png` ⚠️ | **MISLEADING.** Probe default: z10.5, default-ON route/rabbit/check-in groups drawn | The colourful blob near the Strip is the **route groups**, not the heat map. Visually indistinguishable from `shot-dc33-only.png` |
| `shot-dc33-only.png` ⚠️ | **MISLEADING.** Same as above | Same blob. Kept for provenance only — do not cite as heat-map evidence |
| `shot-dc34-only.png` ⚠️ | **MISLEADING.** Same as above | Same blob. DC34 draws nothing at all |

## How the camera was chosen

Not by eye. A 0.005° grid over every coordinate in the live artifact, with the camera
parked on the densest cell. `queryRenderedFeatures` hit-testing at z14.2 finds up to
**36 overlapping features under a single screen pixel**. If "overlap is heat" were legible
at the shipped values, it would be legible there.

### Re-derived after the 71-15 republish

Plan 71-15 republished the DC33 artifact (110 → 90 runs, 20 degenerate null-island
features removed), so the hotspot was **re-derived from the new live bytes** rather than
inherited. Measured against the artifact now being served:

| Quantity | Value |
|---|---|
| Live artifact | 90 runs, **19 961** coordinates (was 20 001 — exactly the 40 coords of the 20 removed 2-point features) |
| Peak cell | lon `[-115.170, -115.165)` × lat `[36.125, 36.130)` |
| Points in peak cell | **1 333** |
| Runs through peak cell | **40 of 90** |
| Camera actually used | `-115.163, 36.127` (unchanged from the 71-08 captures) |
| Camera → peak-cell offset | **408 m** |

**The recorded camera still frames the hotspot, so it was deliberately left unchanged** —
keeping it identical is what makes the 0.25 / 0.70 side-by-side above a controlled
comparison. The 408 m offset is far smaller than either viewport, and coverage is
effectively identical either way:

| Camera | Zoom | Viewport | Coordinates in frame | Runs in frame |
|---|---|---|---|---|
| recorded `-115.163, 36.127` | z12.6 | 28.5 × 19.3 km | 14 816 (74.2%) | 69 / 90 |
| true peak `-115.1675, 36.1275` | z12.6 | 28.5 × 19.3 km | 14 816 (74.2%) | 69 / 90 |
| recorded `-115.163, 36.127` | z14.2 | 9.4 × 6.4 km | 13 154 (65.9%) | 67 / 90 |
| true peak `-115.1675, 36.1275` | z14.2 | 9.4 × 6.4 km | 13 159 (65.9%) | 67 / 90 |

The peak is unchanged by the republish, which is the expected result: every feature 71-15
removed was a zero-length line at **null island**, contributing nothing to the Las Vegas
grid. 71-08 recorded this same cell by its upper edge (`-115.1650, 36.1250`, 1 334 points,
40 of 110 runs) — the same cell under a different labelling convention.

## Reproduce

```bash
MAPBOX_TOKEN=$(aws ssm get-parameter \
  --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
  --query Parameter.Value --output text \
  --profile dc34-application --region us-east-1) \
node capture-heat-visual.cjs
```

`capture-heat-visual.cjs` asserts nothing and gates nothing. The gate is the
**19-assertion** `heatmap-probe.cjs`, which was **not** modified by any of this work —
it is byte-identical (`sha256 0b294c08…`) to the version that produced
`transcript-gap-pre.txt`, which is what makes the 8/19 → 17/19 contrast evidence.

### One change to the capture script in plan 71-16

The master-checkbox sweep only clicks a section master that reports `checked`. A master in
the **indeterminate** tri-state reports `false` and was skipped, so on the current
five-section tree the first re-capture still had `overpass` and the three `dc34-rabbits-*`
layers — plus two DOM marker beacons, which are not style layers at all — drawn over the
heat stack. Since the plan requires every non-heat layer hidden in the visual record, the
script now force-hides any remaining non-heat layer through the map API and removes marker
and popup DOM nodes. It changes only **what is drawn in a capture**; this file still
asserts nothing and gates nothing, and the probe was not touched.
