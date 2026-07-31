---
created: 2026-07-31T04:35:00Z
updated: 2026-07-31T22:20:00Z
title: "gpx heat map — 5-10 Aug 2026 con re-probe (paint + data-quality items RESOLVED by Phase 71 gap closure)"
area: run.gpx
priority: high
---

Originally two items from Phase 71 (71-08). **Item 1 and its data-quality sub-finding are now
RESOLVED and shipped** — see below. **Item 2, the dated con re-probe, remains open** and is the
only reason Phase 71 is not marked complete.

---

## 1. DC33 heat stack invisible at shipped paint values — ✅ RESOLVED, LIVE

Closed by the Phase 71 gap closure (plan **71-09**), shipped in **run.gpx v0.0.110** on
2026-07-31.

- **D-13** locked `line-opacity` **0.25 → 0.70** (the literal in source is `0.7`; Prettier
  normalises trailing zeros). `line-color #ff8c00` / `#ff0000` and `line-width 3` unchanged and
  still Kurt-locked.
- Probe **assertion 19** reads `line-opacity` back off the **live Mapbox style object** as `0.7`,
  so the paint contract is pinned at runtime, not merely in source.
- **Confirmed by Kurt on real hardware, 2026-07-31** — the check the original note called for
  ("a quick look on a real browser before re-tuning is cheap and worth doing"). Screenshot at
  `gpx.defcon.run/use1/studio/app#18.21/36.133603/-115.158769/11.2/53` (LVCC / Westgate
  Connector) shows the LVCC Loop → Westgate corridor as a thick bundle of dozens of overlapping
  strands while one-off spurs stay thin single strokes. The density gradient reads. Recorded as
  UAT test 1 pass in `71-UAT.md`.

The open colour-contrast question (`#ff8c00` sitting close to the basemap's orange road casings)
was **not** pursued — at 0.70 the stack is legible without it. Re-open only if it reads poorly
against a different basemap style.

### Related data-quality finding — ✅ RESOLVED, LIVE

Closed by plans **71-10** (filter at the assembly point + the standalone verifier learned to
reject degeneracy) and **71-15** (republished the frozen DC33 artifact through the new filter).

- The 20 degenerate `[[0,0],[0,0]]` features are gone: the live artifact now has **0 degenerate**
  of **90** features, independently re-verified by the Phase 71 security audit's structural walk.
- `runCount` **110 → 90**. `totalKm` **658.4 → 658.4**, unmoved to the decimal — the invariant
  proving no real run was dropped. A set comparison confirmed the 90 published features *are*
  the 90 non-degenerate features from before.
- `generatedAt` deliberately unchanged (`2025-08-15T02:41:54.347Z`) — it is the honest Aug-2025
  export instant, and probe assertion 6 is pinned to that literal.
- The wider "41 of 110 features have no coordinate inside the Las Vegas box" observation is
  partly absorbed by the degeneracy filter; any residual out-of-box features are in-range,
  non-degenerate real geometry and were **not** filtered. Not currently believed to be a defect.

---

## 2. Re-probe during DEF CON 34, 5-10 August 2026 — ⏳ STILL OPEN

**This is the only remaining blocker on Phase 71 completion.**

`71-08-probes/heatmap-probe.cjs` now carries **19 assertions** (71-12 raised it from 13) and
scores **17/19** against production. Assertions **5** (dc34 leg) and **11** are red for exactly
one reason: **DC34 has no runs yet.** Verified at the data layer — a live `heatmap-build-use1`
invoke on 2026-07-31 returned `runCount: 0`. CON_DAYS for DC34 is 2026-08-05 … 2026-08-10.

**17/19 is the perfect pre-con score, not a shortfall.** The probe was deliberately **not**
softened and no synthetic data was injected (Kurt declined both, twice).

**During 5-10 Aug 2026, run the probe unmodified** and confirm:

- assertion 7's `generatedAt` **moves hourly**, not just daily — the only way to observe the
  con-window schedule `cron(0 * 5-10 8 ? 2026)`, which physically cannot fire before 5 Aug and
  is the open half of ROADMAP SC-2. (Note the daily schedule moved to `cron(20 4 * * ? *)` in
  71-14 so it can no longer collide with the hourly on con days.)
- assertion 5 passes for **dc34** as well as dc33;
- assertion 11 passes — both stacks on the map together at their locked colours;
- **then** make the D-12 two-colour overlap read, which is unperformable today because DC34
  draws nothing. 71-CONTEXT.md calls this "the emotional core of the feature" and it has
  **never been rendered**.

```bash
MAPBOX_TOKEN=$(aws ssm get-parameter \
  --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
  --query Parameter.Value --output text \
  --profile dc34-application --region us-east-1) \
node .planning/phases/71-heat-map-layers-*/71-08-probes/heatmap-probe.cjs
```

Expect **19/19**. Then re-run phase verification so `71-VERIFICATION.md` can move off
`human_needed` and Phase 71 can be marked complete.
