# Phase 44 — Deferred / Out-of-Scope Items

Pre-existing issues discovered during 44-01 execution that are NOT caused by this
plan's changes (entities-only scope). Logged, not fixed, per the executor scope
boundary.

## Pre-existing `tsc --noEmit` errors (unrelated files)

Present before 44-01 touched anything; none are in the files this plan edited
(`entities/qr.ts`, `entities/run-user.ts`, `entities/ctf.ts`, the two
`__tests__/*-key-parity.test.ts`). All key-parity/entity files compile clean.

1. `src/components/header/dropdown-user.tsx(34,24)` — `TS2307: Cannot find module
   '@public/header/dcjack.svg'` (missing SVG type decl / asset alias).
2. `src/entities/__tests__/checkin.test.ts(108-111)` — `TS2339: Property 'model'
   does not exist on type 'Entity<...>'` (ElectroDB type-inference on `.model`
   access in an unrelated test, 4 occurrences).

These do not affect vitest execution (the parity tests pass green).
