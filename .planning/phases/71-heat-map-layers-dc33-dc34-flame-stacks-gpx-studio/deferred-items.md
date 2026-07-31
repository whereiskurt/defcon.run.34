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

## D-71-D — `LayerControl.svelte` fails `prettier --check` on the untouched tree

- **Found during:** 71-06 Task 3 verification
- **Symptom:** `prettier --check src/lib/components/map/layer-control/LayerControl.svelte`
  warns "Code style issues found" — seven over-long lines that prettier wants
  wrapped (lines 125-186 and 375-377 of the current file).
- **Pre-existing:** yes, and proven so: the same check run against a pristine
  `git show HEAD:...LayerControl.svelte` copy placed inside the project warns
  identically. A `prettier --write` on a copy of the 71-06 working file changes
  ONLY those pre-existing ranges — none of the lines this plan added.
- **Impact:** the prettier half of `npm run lint` cannot pass for this one file.
  Not fixed here: reformatting ~20 unrelated lines would bury this plan's
  three-line diff and churn blame on code 71-06 never touched.
- **Suggested owner:** a repo-wide `npm run format` sweep of the vendored studio
  tree, not Phase 71.

## D-71-E — the studio's "30-error svelte-check baseline" is really 26 + 4 env-dependent

- **Found during:** 71-06 Task 3 verification
- **Symptom:** the total dropped 30 → 26 mid-plan with no source change able to
  explain it. The four that vanished are all the same message —
  `Module '"$env/static/public"' has no exported member 'PUBLIC_MAPBOX_TOKEN'` in
  `utils.ts`, `Map.svelte`, `embedding.ts`, `EmbeddingPlayground.svelte`.
- **Cause:** running `PUBLIC_MAPBOX_TOKEN=pk.placeholder npm run build` regenerates
  `.svelte-kit`'s generated `$env/static/public` type declaration WITH the token,
  which retires those four errors until something syncs without it. Nothing to do
  with any source file.
- **Impact on the delta gate:** none — the gate that matters is "0 errors attributed
  to the changed files", which held at every step. But a future plan quoting a bare
  "total must equal 30" will mis-fire depending on whether a build ran first. Quote
  **26 + 4** and check whether the four `PUBLIC_MAPBOX_TOKEN` lines are present.
