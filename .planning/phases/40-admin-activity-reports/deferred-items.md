# Deferred Items — Phase 40 Admin Activity Reports

Out-of-scope discoveries logged during plan execution. NOT fixed (scope boundary:
only issues directly caused by the current task's changes are auto-fixed).

## Pre-existing tsc errors in run.human (discovered during 40-03, Task 2)

`npx tsc --noEmit -p tsconfig.json` in `apps/run.human/webapp` reports 5 errors,
none introduced by 40-03 (my changed files `log-event.ts`, `checkins/route.ts`,
`upload/presign/route.ts` are all clean). These exist on the base branch:

- `src/components/header/dropdown-user.tsx(32,24)` — `error TS2307: Cannot find module '@public/header/dcjack.svg' or its corresponding type declarations.` (missing SVG module ambient declaration)
- `src/entities/__tests__/checkin.test.ts(108–111)` — `error TS2339: Property 'model' does not exist on type 'Entity<...>'` (ElectroDB typing in an existing test, 4 occurrences)

**Disposition:** deferred — unrelated to activity logging; fixing them is outside
the 40-03 scope. Recommend a follow-up todo to add an `*.svg` module declaration
and update the checkin entity test's ElectroDB access pattern.
