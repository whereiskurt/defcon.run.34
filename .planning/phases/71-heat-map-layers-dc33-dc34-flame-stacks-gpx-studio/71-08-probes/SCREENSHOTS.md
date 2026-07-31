# Phase 71 — heat-map visual evidence, captioned

Read this before trusting any image in this directory. Two of the originals are
misleading and are kept only because deleting evidence is worse than labelling it.

Everything below is DC33 at the **live shipped** D-02 paint values unless a filename
says `DIAG`. `DIAG` shots were produced by changing `line-opacity` **in the browser at
runtime for diagnosis only** — nothing was re-released and `HEAT_PAINT` was not edited.

## The finding, in one line

At the shipped values (`line-color #ff8c00`, `line-opacity 0.25`, `line-width 3`) the DC33
stack is **not faint — it is invisible**, even with every other layer hidden and 36
overlapping runs under a single screen pixel.

| File | Capture conditions | What it actually shows |
|---|---|---|
| `shot-dc33-SHIPPED-0.25-invisible.png` | **Shipped values.** All non-heat layers force-hidden. z14.2 on the measured density hotspot | **Nothing.** No orange stack is discernible anywhere. This is the honest record of what a user sees today |
| `shot-dc33-DIAG-0.45-marginal.png` | opacity raised to **0.45** at runtime, otherwise identical | Visible but marginal — reads as thin orange line-work easily confused with the basemap's own orange road casings |
| `shot-dc33-DIAG-0.70-legible.png` | opacity raised to **0.70** at runtime, otherwise identical | **The effect D-12 is asking for.** The Strip corridor, LVCC Loop, Convention Center and Westgate all read, and busy corridors are visibly heavier than one-off spurs — density gradient is legible |
| `shot-dc33-DIAG-opacity1-magenta-geometry-proof.png` | opacity 1.0, width 4, colour forced `#ff00ff` | Proof the **data and the render path are fine**: a dense, correctly-georeferenced network of runs. Rules out "bad geometry" and "layer not painting" as explanations |
| `shot-both-layers-clean.png` | Shipped values, both rows ON, overlays off, z12.6 | Both heat rows enabled. DC34 contributes **nothing** — it has 0 runs. Not a rendering fault |
| `shot-both-layers.png` ⚠️ | **MISLEADING.** Probe default: z10.5, default-ON route/rabbit/check-in groups drawn | The colourful blob near the Strip is the **route groups**, not the heat map. Visually indistinguishable from `shot-dc33-only.png` |
| `shot-dc33-only.png` ⚠️ | **MISLEADING.** Same as above | Same blob. Kept for provenance only — do not cite as heat-map evidence |
| `shot-dc34-only.png` ⚠️ | **MISLEADING.** Same as above | Same blob. DC34 draws nothing at all |

## How the camera was chosen

Not by eye. A 0.005° grid over all 20 001 coordinates in the live artifact peaks at
`-115.1650, 36.1250` with 1 334 points, and **40 of the 110 runs** pass through that one
cell. `queryRenderedFeatures` hit-testing at z14.2 finds up to **36 overlapping features
under a single screen pixel**. If "overlap is heat" were legible at the shipped values,
it would be legible there.

## Reproduce

```bash
MAPBOX_TOKEN=$(aws ssm get-parameter \
  --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
  --query Parameter.Value --output text \
  --profile dc34-application --region us-east-1) \
node capture-heat-visual.cjs
```

`capture-heat-visual.cjs` asserts nothing and gates nothing. The 13-assertion gate is
`heatmap-probe.cjs`, which was **not** modified by any of this work.
