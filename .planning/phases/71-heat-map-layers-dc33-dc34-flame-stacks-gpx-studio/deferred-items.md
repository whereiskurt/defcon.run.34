# Phase 71 — Deferred / Out-of-Scope Discoveries

Items found during execution that were NOT caused by this phase's changes.
Logged, not fixed (executor scope boundary).

## D-71-A — `npx eslint` crashes on config load in `apps/run.gpx/webapp`

- **Found during:** 71-01 Task 1 (running lint on the two new lib modules)
- **Symptom:** `npx eslint <any file>` exits with
  `TypeError: Converting circular structure to JSON` inside
  `@eslint/eslintrc/lib/shared/config-validator.js` while normalising an
  extended shareable config (`property 'react' closes the circle`).
- **Pre-existing:** yes — reproduced against untouched `src/lib/con-days.ts`
  on a clean tree, before any Phase 71 file was written.
- **Impact:** `npm run lint` is non-functional for run.gpx/webapp. Type safety
  is unaffected (`npx tsc --noEmit` is clean) and `npm test` is green.
- **Likely cause:** eslint 9.39 flat-config loading an eslintrc-era shareable
  config (`eslint-config-next` / `eslint-plugin-react` self-reference).
- **Suggested owner:** a standalone tooling fix, not Phase 71.
