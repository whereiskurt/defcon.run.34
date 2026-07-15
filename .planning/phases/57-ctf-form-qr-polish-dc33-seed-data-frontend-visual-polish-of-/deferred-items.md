# Deferred Items — Phase 57

Out-of-scope discoveries logged during execution (NOT fixed — outside the current plan's scope).

## 57-01 (Surface A restyle)

- **Pre-existing `tsc --noEmit` errors (unrelated to this plan).** `npx tsc --noEmit`
  in `apps/run.human/webapp` reports 5 errors, none in the files this plan touched
  (`CtfForm.tsx` / `qr-ui.ts` are clean):
  - `src/components/header/dropdown-user.tsx(34,24)` — TS2307 cannot find module
    `@public/header/dcjack.svg` (missing SVG module declaration).
  - `src/entities/__tests__/checkin.test.ts(119–122)` — TS2339 `Property 'model'
    does not exist on type 'Entity<…>'` (ElectroDB typings in a test file).
  These predate 57-01 and are unrelated to the CTF form restyle. Left untouched per
  the scope boundary.
