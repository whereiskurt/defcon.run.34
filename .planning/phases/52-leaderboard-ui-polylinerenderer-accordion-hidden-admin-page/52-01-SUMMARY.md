---
phase: 52-leaderboard-ui-polylinerenderer-accordion-hidden-admin-page
plan: 01
subsystem: run.human leaderboard UI
tags: [leaderboard, polyline, canvas, geometry, LDBR-09, dc33-port]
requires:
  - Accomplishment.metadata.polyline ({lat,lng}[] — Phase 50)
provides:
  - lib/polyline-geometry (computeBounds/latLngToTile/calculateZoomLevel/centerTile)
  - components/leaderboard/PolylineRenderer (client canvas thumbnail)
affects:
  - Phase 52 LeaderboardTable (will render PolylineRenderer per run)
tech-stack:
  added: []
  patterns:
    - pure geometry seam extracted for unit-testability (no canvas/DOM)
    - client 'use client' canvas draw pipeline (DC33 faithful port)
key-files:
  created:
    - apps/run.human/webapp/src/lib/polyline-geometry.ts
    - apps/run.human/webapp/src/lib/polyline-geometry.test.ts
    - apps/run.human/webapp/src/components/leaderboard/PolylineRenderer.tsx
  modified: []
decisions:
  - Dropped DC33 decodePolyline/parseGPX — DC34 input is {lat,lng}[] objects already
  - Map math lives in a pure module; the component only draws (testable seam)
  - Default height 120 (plan) vs DC33's 150; all other DC33 draw params preserved
metrics:
  tasks: 2
  files: 3
  duration: ~5m
  completed: 2026-07-14
status: complete
requirements: [LDBR-09]
---

# Phase 52 Plan 01: PolylineRenderer client canvas + pure geometry seam Summary

Ported DC33's `PolylineRenderer` to run.human as a `'use client'` `<canvas>` route
thumbnail (LDBR-09) and extracted its bounds → zoom → center-tile math into a pure,
unit-tested `lib/polyline-geometry.ts` seam — one OSM tile behind a white-halo route
with green-start/red-end dots, a dark-mode canvas filter, and a tile-error fallback,
driven by `points:{lat,lng}[]` objects with NO Google-polyline decode.

## What was built

- **`lib/polyline-geometry.ts`** — pure `computeBounds` (null on empty),
  `latLngToTile` (DC33 floored slippy-map formula), `calculateZoomLevel` (walk 15→10,
  fallback 12), `centerTile` (midpoint→zoom→tile). Zero DOM/fetch/React imports —
  importable in a Node vitest run with no side effects.
- **`lib/polyline-geometry.test.ts`** — 14 vitest cases (RED→GREEN) covering every
  behavior bullet: empty/covers-all/degenerate bounds; the DC33 x-formula and the
  zoom-0/zoom-1 corner tiles; tight-route=15, world-wide fallback=12, degenerate=15;
  centerTile `{zoom,x,y}` from the midpoint. Mirrors the `leaderboard-data.test.ts`
  convention (describe/it/expect, plain fixtures, no mocks).
- **`components/leaderboard/PolylineRenderer.tsx`** — `'use client'` component that
  imports `computeBounds`/`centerTile` from the seam (no inline math), converts the
  object input to `[lat,lng]` pairs, draws the OSM tile (with the DC33 dark-mode
  filter `invert(1) hue-rotate(180deg) brightness(1.2) contrast(0.9)`), a
  semi-transparent wash, the white-halo + colored route (DC33 LINEAR lat/lng→canvas
  scaling), and white-ringed green/red start/end dots. `points.length < 2` draws
  "No route data"; the tile `onerror` still draws the route (DC33 fallback).

## Verification

- `npx vitest run src/lib/polyline-geometry.test.ts` → **14 passed** (Node 23.6.0).
- `npx tsc --noEmit` → **zero errors** in `PolylineRenderer.tsx` / `polyline-geometry.ts`;
  the only residual errors are the two known pre-existing out-of-scope files
  (`dropdown-user.tsx`, `__tests__/checkin.test.ts`), confirming tsc genuinely ran.

## Threat model

- **T-52-02 (DoS on malformed polyline — mitigate):** applied. `points.length < 2`
  short-circuits to "No route data"; `computeBounds` returns `null` on empty input
  (defensive null-guard in the effect); the tile `onerror` path draws the route only.
- **T-52-01 (info disclosure — accept):** OSM tile host is a fixed public endpoint;
  route coords are already visible to the admin viewing the (admin-only) surface.

## Deviations from Plan

None — plan executed exactly as written. (Plan-specified default `height=120` differs
from DC33's `150`; this is the plan's intent, not a deviation.)

## Known Stubs

None. The component draws real route geometry from its input; no placeholder/mock data.

## Self-Check: PASSED

- Files exist: `lib/polyline-geometry.ts`, `lib/polyline-geometry.test.ts`,
  `components/leaderboard/PolylineRenderer.tsx` — all present.
- Commits present: `48dc47fc` (test/RED), `2571789b` (feat/geometry GREEN),
  `647e9557` (feat/PolylineRenderer).
- TDD gates: `test(52-01)` RED commit precedes `feat(52-01)` GREEN commit. Compliant.
