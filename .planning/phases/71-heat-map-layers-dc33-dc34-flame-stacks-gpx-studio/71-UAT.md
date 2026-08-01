---
status: partial
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
source: [71-VERIFICATION.md]
started: 2026-07-31T21:05:00Z
updated: 2026-07-31T21:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. DC33 flame stack reads as heat on real hardware

expected: Open `https://gpx.defcon.run/use1/studio/app` in a REAL browser → Map Layers → turn OFF DEF CON 34 Routes / Rabbit Routes / User Check-ins → turn ON `🔥 DC33 — the classic` → zoom to the Strip. A visible orange flame stack whose busy corridors read heavier than one-off spurs.
result: pass
evidence: |
  Kurt supplied a live screenshot on real hardware, 2026-07-31 — Chrome at
  `gpx.defcon.run/use1/studio/app#18.21/36.133603/-115.158769/11.2/53` (LVCC / Westgate
  Connector, 20 m scale bar, 3D pitch). The DC33 stack renders in ember orange with an
  unmistakable density gradient: the LVCC Loop → Westgate Connector corridor is a thick
  bundle of dozens of overlapping near-parallel strands with visible GPS jitter, while
  one-off spurs at the frame edges remain thin single strokes. This is the "overlap = heat"
  property the phase exists to deliver, and it closes the D-13 judgement that no headless
  capture could settle — the same view at 0.25 was invisible.
  **This supersedes the "accepted on evidence, not performed" status recorded in
  71-16 Task 5 for this item: a human has now looked at real hardware.**

Why a human: **Known, deliberately-accepted residual — not a discovery.** 71-16 Task 5 was
closed on evidence 2026-07-31; the browser check was explicitly not performed. Every capture
in this phase is headless Chromium on a software rasteriser, and D-13 (opacity 0.25 → 0.70)
is fundamentally a judgement about whether the stack reads as heat *to a human eye*. Both the
executor and the verifier inspected `shot-dc33-SHIPPED-0.70-detail.png` and found it legible
with a real density gradient — but that is a read of a headless capture, not of real hardware.
Machine-side the paint contract is confirmed: probe assertion 19 reads `line-opacity` off the
live Mapbox style object as `0.7`, colours `#ff8c00`/`#ff0000` and width 3 unchanged.

### 2. DC33 hint bar shows the corrected count

expected: The DC33 hint bar in the live studio reads ~90 runs and ~658.4 km (down from the pre-fix 110 runs).
result: pass
evidence: |
  Confirmed by Kurt on real hardware, 2026-07-31. The UI renders the corrected count, matching
  the machine-verified served meta (`?meta=1` -> runCount 90, totalKm 658.4). Closes 71-16
  Task 5 residual item 2.

Why a human: 71-16 Task 5 residual item 2. The *served* meta is machine-verified —
`?meta=1` returns `{"year":"dc33","generatedAt":"2025-08-15T02:41:54.347Z","runCount":90,"totalKm":658.4}`
— what is unconfirmed is the number a person actually sees rendered in the UI.

### 3. Ghost claim link still works end to end

expected: A meshtk claim link (`MESHTK_RUN_INTERNAL_URL` → run.human `/api/internal/ctf/mint`) mints and resolves normally — the CloudFront edge block did not widen onto the con-critical CTF flow.
result: pass
reported: "test goldstein and mudge working! pass"
evidence: |
  Kurt exercised TWO live ghost claim links end to end on 2026-07-31 — goldstein and mudge —
  both working. This is strictly stronger than probe assertion 16, which proves only that the
  edge declined to intercept (mint -> 405, quota -> 401, neither marked); this proves the full
  mint-and-resolve flow still completes through run.human. The 71-13 CloudFront edge block is
  confirmed correctly scoped to gpx internal paths and has NOT widened onto the con-critical
  CTF flow. Closes 71-16 Task 5 residual item 3.

Why a human: 71-16 Task 5 residual item 3. Probe assertion 16 — the blast-radius regression
gate — is GREEN and was independently re-derived three times (mint → 405, run.auth quota → 401,
**neither** carrying `x-dc34-edge-block`). But a 405/401 proves only that the edge did not
intercept the request; it does not prove the full mint flow still completes.

### 4. Con-window re-probe (dated: 5–10 Aug 2026)

expected: Re-run `71-08-probes/heatmap-probe.cjs` unmodified during 2026-08-05..10 and confirm assertions 5 (dc34 leg) and 11 go green — including D-12's two-colour clause: `🔥 DC33` and `🔥 DC34` legible SIMULTANEOUSLY. Target 19/19.
result: blocked
blocked_by: calendar
reason: |
  Cannot run before 2026-08-05. DEF CON 34 runs 2026-08-05..10; on 2026-07-31 zero runs carry
  a conDay, confirmed by a live `heatmap-build-use1` invoke returning `runCount: 0`. Probe
  assertions 5 (dc34 leg) and 11 are therefore legitimately red, and **17/19 is the perfect
  pre-con score, not a shortfall**. This is a dated gate, NOT a defect and NOT a failure.
  Re-run `71-08-probes/heatmap-probe.cjs` unmodified during the con and expect 19/19,
  including D-12's two-colour clause. Until then the simultaneous DC33+DC34 overlap that
  71-CONTEXT.md calls the emotional core of the feature has never been rendered.

recorded: |
  Kurt initially typed `pass`; flagged as not physically possible on 2026-07-31 and, on
  being asked, chose to record it as a dated gate rather than a pass.

Why a human: **Calendar-bound, not a defect.** DEF CON 34 runs 2026-08-05..10; as of
2026-07-31 zero runs carry a `conDay`, so dc34 legitimately has `meta.runCount: 0` and zero
features. **17/19 is the perfect pre-con score** and must not be read as a shortfall. The
two-colour overlap that 71-CONTEXT.md calls "the emotional core of the feature" has therefore
still never been rendered and cannot be until the con.

## Summary

total: 4
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps
