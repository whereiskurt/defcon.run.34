# Deferred / Out-of-Scope Items — Phase 50

## Pre-existing test + typecheck failures (NOT introduced by Plan 50-01)

- `src/entities/__tests__/checkin.test.ts` — 5 vitest failures (`createCheckIn`/`deleteCheckIn`)
  and 4 `tsc` errors (`Property 'model' does not exist` at lines 108–111). This file and its
  entire import graph (`checkin.ts`, `accomplishment.ts`, `run-user.ts`,
  `leaderboard-scoring.ts`) are UNTOUCHED by Plan 50-01. Same electrodb-typing/mocking issue
  the plan-checker flagged. Out of scope for this plan.
- `src/components/header/dropdown-user.tsx` — `tsc` error `Cannot find module
  '@public/header/dcjack.svg'` (svg module typing). Pre-existing, out of scope.

These are the ONLY tsc errors and the ONLY vitest failures in the run.human suite; none are in
files this plan created or modified.
