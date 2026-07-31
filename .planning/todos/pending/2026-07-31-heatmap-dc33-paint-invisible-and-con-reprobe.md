---
created: 2026-07-31T04:35:00Z
title: "gpx heat map — DC33 stack renders INVISIBLE at shipped paint values; plus the 5-10 Aug 2026 con re-probe"
area: run.gpx
priority: high
---

Two items from Phase 71 (71-08), both left open deliberately. The first is a **live defect in
what users see today**; the second is a **dated re-check** that will resolve itself at the con.
Full evidence: `.planning/phases/71-heat-map-layers-.../71-08-SUMMARY.md` and
`71-08-probes/SCREENSHOTS.md`.

---

## 1. DC33 heat stack is invisible at the shipped D-02 paint values — needs Kurt's call

**Live now on gpx.defcon.run v0.0.109.** Turning on 🔥 DC33 changes the map by nothing a user
can see.

`HEAT_PAINT` in `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts:86-98`
ships `line-color #ff8c00`, `line-opacity 0.25`, `line-width 3`. Measured against production:

| opacity | result |
|---|---|
| **0.25 (shipped)** | **invisible** — nothing discernible, even with every other layer hidden |
| 0.45 | marginal; reads as thin orange line-work easily confused with the basemap's own orange road casings |
| **0.70** | **legible, and the density gradient reads** — Strip / LVCC Loop / Convention Center clearly heavier than one-off spurs |

This is **not** a data problem and **not** a render-path problem, both ruled out:

- A 0.005° density grid over all 20 001 live coordinates peaks at `-115.1650, 36.1250`, where
  **40 of the 110 runs** pass through one cell; `queryRenderedFeatures` finds up to **36
  overlapping features under a single screen pixel**.
- `queryRenderedFeatures` returns 82 features at z12.6 and 208 at z14.2 — mapbox believes it is
  drawing them, and `heatmap-dc33` is the **topmost** layer in the style (index 44 of 45).
- Forcing `line-opacity 1 / width 4 / #ff00ff` at runtime produces a dense, correctly
  georeferenced network (`shot-dc33-DIAG-opacity1-magenta-geometry-proof.png`).

**Nothing was changed.** D-02's colour/width/opacity are Kurt-locked, so this is a decision, not
an executor fix. Also worth deciding: `#ff8c00` ember-orange sits very close to the default
basemap's own orange road casings, so contrast is poor at *any* opacity — DC34's `#ff0000`
should fare better. Options: raise opacity toward ~0.6-0.7; and/or re-pick DC33's colour for
basemap contrast; and/or add a subtle dark halo/casing under the line.

**Caveat, stated honestly:** all captures were headless Chromium on swiftshader. The 0.70 and
1.0 renders prove low-alpha blending *works* in that environment, so a pure headless artifact is
unlikely — but a quick look on a real browser before re-tuning is cheap and worth doing.

### Related data-quality finding (separate, smaller)

The live `dc33.json` carries junk the DC33 backfill (71-04) let through:

- **20 of 110 features contain a `[0, 0]` coordinate**; `features[0]` is literally
  `[[0,0],[0,0]]` — a degenerate 2-point line at null island.
- **41 of 110 features have no coordinate inside the Las Vegas box at all**; the artifact bbox
  spans `lon -119.06 … 0` and `lat 0 … 53.40`.

Nothing crashes and `assertNonAttributable` is unaffected (privacy is fine), but those features
are noise in a "DEF CON 33 heat map" and inflate `runCount` (110) beyond what actually renders
over Vegas (~69). Worth a filter in the builder / a re-run of the backfill.

---

## 2. Re-probe during DEF CON 34, 5-10 August 2026

`71-08-probes/heatmap-probe.cjs` currently scores **11/13** against production. Assertions **5**
(dc34 leg) and **11** are red for exactly one reason: **DC34 has no runs yet.** Verified at the
data layer — `aws dynamodb scan --table-name run-gpx-electro --filter-expression
"attribute_exists(conDay)" --select COUNT` returns **0 of 133**. CON_DAYS for DC34 is
2026-08-05 … 2026-08-10.

The probe was deliberately **not** softened and no synthetic data was injected (Kurt declined
both). These should go green on their own during the con.

**During 5-10 Aug 2026, run the probe unmodified** and confirm:

- assertion 7's `generatedAt` **moves hourly**, not just daily — this is the only way to observe
  the con-window schedule `cron(0 * 5-10 8 ? 2026)`, which physically cannot fire before 5 Aug
  and is the open half of ROADMAP SC-2;
- assertion 5 passes for **dc34** as well as dc33;
- assertion 11 passes — both stacks on the map together at their locked colours;
- **then** make the D-12 two-colour overlap read (Task 4 step 5), which is unperformable today
  because DC34 draws nothing.

```bash
MAPBOX_TOKEN=$(aws ssm get-parameter \
  --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
  --query Parameter.Value --output text \
  --profile dc34-application --region us-east-1) \
node .planning/phases/71-heat-map-layers-*/71-08-probes/heatmap-probe.cjs
```

If item 1 above is re-tuned before the con, re-shoot the visual evidence at the same time.
