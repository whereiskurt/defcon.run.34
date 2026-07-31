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

## D-71-B — `npm run lint` cannot run in `apps/run.gpx/gpx-studio/website`

- **Found during:** 71-05 Task 2 (linting the two changed studio files)
- **Symptom:** `npx eslint <any file>` exits with
  `ESLint couldn't find an eslint.config.(js|mjs|cjs) file` — the vendored
  package ships `.eslintrc.cjs` + `.eslintignore` (eslint 8 era) while the
  installed binary is eslint 9.28.0, which no longer reads either.
- **Pre-existing:** yes — the package has no flat config at all; nothing in this
  phase touched eslint config, `package.json`, or any dependency.
- **Impact:** only the eslint half of `npm run lint`. The prettier half runs and
  passes for both files changed by 71-05, and `svelte-check` holds the exact
  30-error upstream baseline with 0 errors on either file.
- **Suggested owner:** an upstream/vendored-tree tooling fix (migrate
  `.eslintrc.cjs` → `eslint.config.js`), not Phase 71.

## D-71-C — bare `npm run build` in the studio needs `PUBLIC_MAPBOX_TOKEN`

- **Found during:** 71-05 Task 2 verification
- **Symptom:** `npm run build` fails at
  `src/lib/utils.ts (8:9): "PUBLIC_MAPBOX_TOKEN" is not exported by "virtual:env/static/public"`
  after transforming all 4859 modules — an env prerequisite, not a code error.
- **Pre-existing:** yes. The shipped build path already handles it:
  `apps/run.gpx/build-frontend.sh:210-215` sources the token from the webapp
  `.env` and falls back to `pk.placeholder`.
- **Resolution here:** verification ran `PUBLIC_MAPBOX_TOKEN=pk.placeholder npm run build`
  (exit 0). Any future plan whose `<verify>` block says a bare `npm run build`
  must export the same placeholder.
