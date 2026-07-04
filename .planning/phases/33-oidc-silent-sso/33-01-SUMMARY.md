---
phase: 33-oidc-silent-sso
plan: 01
subsystem: run.auth (OIDC IdP)
tags: [oidc, sso, oidc-provider, auto-consent, grant, session, vitest]
status: complete
requires:
  - oidc-provider@9.6.0 loadExistingGrant hook + session.grantIdFor
  - config.oidc.clients allowlist (single source)
provides:
  - interactions.url resolves to server interaction-completion route (no page render for warm users)
  - makeLoadExistingGrant auto-consent factory (mint/reuse/undefined) wired into provider config
  - remember:true on both login branches (persistent 15-day provider _session)
  - vitest runner for run.auth webapp + auto-consent unit suite
affects:
  - RP silent-SSO unit (33-02..33-06) depends on this IdP half for prompt=none to succeed
tech-stack:
  added:
    - vitest ^4.1.9 (devDependency; same version locked in run.bib — no new third-party package)
  patterns:
    - dependency-injected factory (pure decision logic, live Provider injected as deps)
    - grant-minting body mirrored from interaction/[uid].ts
key-files:
  created:
    - apps/run.auth/webapp/src/config/load-existing-grant.ts
    - apps/run.auth/webapp/src/config/__tests__/load-existing-grant.test.ts
    - apps/run.auth/webapp/vitest.config.ts
  modified:
    - apps/run.auth/webapp/src/config/oidc.ts
    - apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts
    - apps/run.auth/webapp/package.json
    - apps/run.auth/webapp/package-lock.json
decisions:
  - Used session.grantIdFor(clientId, grantId) setter to record the grant mapping — oidc-provider@9.6.0 has no ensureGrantId method (plan text was wrong; design spec already said session.grantIdFor).
  - loadExistingGrant loads/returns the Grant via ctx.oidc.provider.Grant.find (from context, not an app import) so the factory stays free of app-specific literals.
  - Committed the regenerated package-lock.json (not in plan's files_modified) so the vitest devDependency is reproducible.
metrics:
  duration: ~30m
  completed: 2026-07-04
  tasks: 3
  files_created: 3
  files_modified: 4
---

# Phase 33 Plan 01: IdP Silent-SSO Changes Summary

Repointed oidc-provider's `interactions.url` to the server interaction-completion route, added an injectable `makeLoadExistingGrant` auto-consent factory bounded to the first-party client allowlist, and flipped `remember:true` on both login branches so the provider `_session` persists for the 15-day Session TTL — the IdP half of Approach A that lets a warm `prompt=none` request succeed with no page render.

## What Was Built

**Task 1 — repoint `interactions.url` + persist session** (`591005ea`)
- `interactions.url(ctx, interaction)` now returns `/{region}/api/oidc/interaction/{uid}` (prod) or `/api/oidc/interaction/{uid}` (dev), derived from `config.region`/`config.isDev` mirroring `[uid].ts` `loginPath` (line 9). It no longer references `config.urls.loginPage`. An already-authenticated user completes the interaction server-side; the route itself still falls back to `/{region}/login?oidc={uid}` when `sess_auth` is absent.
- Flipped `remember:false` → `remember:true` on both login-result branches in `[uid].ts` (the `login` prompt branch and the unknown-prompt fallback). The middle `consent` branch (no `login`) is untouched. Exactly two `remember: true` occurrences.
- Updated stale comments to describe the server-route target and the persistent 15-day session.

**Task 2 — injectable `makeLoadExistingGrant` factory** (`bfda4320`)
- New pure module `src/config/load-existing-grant.ts` exporting `makeLoadExistingGrant(deps)` where `deps = { firstPartyClientIds: string[]; createGrant: (a) => Promise<string> }`, returning a `loadExistingGrant(ctx)` hook typed against `Configuration['loadExistingGrant']`. No import of `@/config` or any app-specific module.
- Decision logic: no account or client_id outside the allowlist → `undefined`; existing recorded grant → reuse via `ctx.oidc.provider.Grant.find`; else mint via injected `createGrant`, record with `session.grantIdFor(clientId, grantId)`, return the loaded grant.
- `oidc.ts` registers `loadExistingGrant` built from `Object.values(config.oidc.clients).map(c => c.clientId)` (single source) with an injected `createGrant` mirroring the `[uid].ts` grant body (`new oidc.Grant`, `addOIDCScope`, `save`).

**Task 3 — vitest runner + auto-consent unit suite** (`4f6e9c16`)
- Copied run.bib's `vitest.config.ts` (node env, `@`→`./src`) and extended the include glob to also match `src/**/__tests__/**` for config-adjacent tests.
- Added `"test": "vitest run"` and `vitest ^4.1.9` (same version locked in run.bib — no other new package).
- `load-existing-grant.test.ts` covers the three locked cases plus a no-account guard: unknown client → `undefined` and `createGrant` never called; first-party + no grant → `createGrant` called once with the requested scope and mapping recorded; first-party + existing grant → reuse, no mint. Suite: 4/4 passing.

## Verification

- `npx tsc --noEmit -p tsconfig.json` → exit 0 (after every task).
- `npm run test` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- Read-back: `interactions.url` no longer references `loginPage`; exactly two `remember: true` in `[uid].ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plan-specified `session.ensureGrantId` does not exist in oidc-provider@9.6.0**
- **Found during:** Task 2.
- **Issue:** The plan action said to record the grant with `ctx.oidc.session.ensureGrantId(clientId, grantId)`. Both `@types/oidc-provider` and the runtime `node_modules/oidc-provider/lib/models/session.js` expose only `grantIdFor(clientId)` (getter) and `grantIdFor(clientId, value)` (setter) — there is no `ensureGrantId`. Using it would fail `tsc` and throw at runtime.
- **Fix:** Recorded the mapping via the two-arg `grantIdFor(clientId, grantId)` setter overload. This matches the design spec (CONTEXT.md line 93 / spec line 93, which say `session.grantIdFor`, not `ensureGrantId`).
- **Files:** `src/config/load-existing-grant.ts`.
- **Commit:** `bfda4320`.

**2. [Rule 3 — Blocking] Missing rolldown native binding, then Node `require(ESM)` gap for vitest 4**
- **Found during:** Task 3 (running `npm run test`).
- **Issue (a):** npm 10.7.0 skipped materializing the optional platform binding `@rolldown/binding-darwin-arm64` (known npm optional-deps bug) even though the lockfile lists it — vitest failed with `Cannot find module './rolldown-binding.darwin-arm64.node'`. **Issue (b):** vitest 4.1.9 depends on pure-ESM `std-env@4` and its `config.cjs` does `require('std-env')`, which fails on the default Node 22.1.0 (`ERR_REQUIRE_ESM`; `require(ESM)` is not on by default until Node 22.12/23).
- **Fix (a):** Materialized the binding with `npm install @rolldown/binding-darwin-arm64@1.1.4 --no-save --no-package-lock` (no package.json/lock change; it is already a transitive optional dep). **Fix (b):** Ran the suite under the repo's already-installed Node 23.6.0 (nvm), which has `require(ESM)` enabled by default — 4/4 passing, no flags. No app code changed; this is an environment/tooling resolution only.
- **Files:** none (tooling/environment).
- **Commit:** n/a.

### Additional note (not a code deviation)

- Regenerated and committed `apps/run.auth/webapp/package-lock.json` (not listed in the plan's `files_modified`) so the added `vitest` devDependency is reproducible. The regeneration was a clean reinstall (stale `node_modules`/lock moved aside), producing a large but legitimate lock diff (the vitest subtree).

## Threat Model Coverage

- **T-33-01 (Elevation of Privilege — auto-consent):** mitigated. Auto-consent is bounded to `Object.values(config.oidc.clients)`; unknown client_id → `undefined`. Unit test case (a) asserts the allowlist boundary and that `createGrant` is never called.
- **T-33-02 (Information Disclosure — grant scope):** mitigated. The minted grant covers only `ctx.oidc.params.scope`; test case (b) asserts scope pass-through with no broadening.
- **T-33-03 (Session persistence, remember:true):** accepted tradeoff; `rpInitiatedLogout` still clears both provider `_session` and `sess_auth`.
- **T-33-SC (vitest devDependency):** accepted; reused run.bib's exact `^4.1.9` — no new third-party package.

No new security-relevant surface beyond the plan's `<threat_model>`.

## Known Stubs

None. `loadExistingGrant` is fully wired into the provider config and covered by unit tests.
