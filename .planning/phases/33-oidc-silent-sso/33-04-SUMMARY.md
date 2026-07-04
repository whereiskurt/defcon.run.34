---
phase: 33-oidc-silent-sso
plan: 04
subsystem: run.auth (OIDC IdP) — e2e integration tests
tags: [oidc, sso, prompt-none, playwright, integration-test, redirect, pkce]
status: complete
requires:
  - plan-01 IdP changes live (interactions.url repoint, loadExistingGrant auto-consent, remember:true)
  - run.auth/e2e @playwright/test package + cookie-jar helpers (loadCookiesForUser)
provides:
  - IdP-level integration suite proving the five locked provider behaviors at the raw 302 layer
  - availability-gated Playwright cases (silent code, login_required, interaction-route target, auth/unauth render split)
affects:
  - phase 33 verification (SSO-06); regression guard for T-33-09 (no silent code without a session)
tech-stack:
  added: []
  patterns:
    - no-follow (maxRedirects:0) redirect walker over the authorize->interaction chain
    - PKCE S256 authorize-URL builder from Node crypto
    - availability gating via test.skip (mirrors session-valid.spec.ts hasCookieJar gate)
key-files:
  created:
    - apps/run.auth/e2e/tests/silent-sso.spec.ts
  modified: []
decisions:
  - Reused run.auth/e2e's existing @playwright/test + cookie-jar helpers; no new package, no new e2e project (plan key_links / T-33-SC).
  - Case A/D establish the provider _session via a warm-up interactive authorize (prompt=none only succeeds once the oidc-provider _session exists, not from sess_auth alone).
  - Authorize client_id/redirect_uri parameterized via env (OIDC_CLIENT_ID/OIDC_REDIRECT_URI) with dev defaults; cases skip when unconfigured rather than hardcoding deployment ids/secrets.
  - Live-service cases gate on IdP reachability + cookie-jar presence and SKIP (not fail) when unavailable — no fabricated green.
metrics:
  duration: ~25m
  completed: 2026-07-04
  tasks: 2
  files_created: 1
  files_modified: 0
---

# Phase 33 Plan 04: Silent-SSO IdP Integration Tests Summary

Added `apps/run.auth/e2e/tests/silent-sso.spec.ts` — a Playwright integration suite that asserts, at the raw HTTP/302 redirect layer, the five locked provider behaviors from the design's Testing Strategy: silent `code` issuance for a warm `prompt=none` request, `login_required` for a sessionless `prompt=none`, that `interactions.url` now targets the server interaction route, and that an authenticated interaction completes without rendering `/login` while an unauthenticated one still falls back to it. Reuses the existing `@playwright/test` package and cookie-jar helpers — no new dependency, no new e2e project.

## What Was Built

**Task 1 — prompt=none silent-code + no-session cases (A/B)** (`1f6261f1`)
- New `tests/silent-sso.spec.ts` in the `run.auth/e2e` package. Imports only from `@playwright/test` and the existing `../lib/cookie-jar.js` (`loadCookiesForUser`, `hasCookieJarForUser`, `getEmailForRole`). Mirrors `session-valid.spec.ts`'s `BASE_URL` / `REGION_PREFIX` region conventions.
- `buildAuthorizeUrl()` constructs a full authorization-code + PKCE (S256, via Node `crypto`) authorize request against `${BASE_URL}${REGION_PREFIX}/api/oidc/auth` with `response_type=code`, a registered `redirect_uri`, `scope`, `state`, `nonce`, `code_challenge`, and optional `prompt=none`.
- `walkRedirects()` follows the 3xx chain with `maxRedirects: 0`, capturing each `Location` so the raw 302s can be inspected; it stops when the chain leaves the IdP origin (final hop to the RP `redirect_uri`) or reaches `/login` (asserted on, never fetched — so no login HTML is rendered).
- **Case A** (warm session): loads the acquired session, runs a warm-up interactive authorize to establish the provider `_session`, then asserts a `prompt=none` authorize terminates at the client `redirect_uri` carrying `code=` with no `/login` in the chain.
- **Case B** (no session): a fresh (cookieless) `request` context issues `prompt=none` and asserts the terminal `Location` carries a `login_required`-class `error` and no `code` — the T-33-09 regression guard.

**Task 2 — interaction-route target + auth/unauth render split (C/D/E)** (`232a0a25`)
- **Case C**: a no-session interactive authorize redirects into `/api/oidc/interaction/…` — proving `interactions.url` was repointed off `${loginPage}?oidc=` to the server route (`chainTargetsInteractionRoute`).
- **Case D** (authenticated): with the warm session loaded, the interaction completes server-side through the interaction route to a `code` at the `redirect_uri`, and `/login` is never touched (`chainTouchesLogin` is `false`).
- **Case E** (unauthenticated): the interaction route still redirects to `/{region}/login?oidc={uid}` (region-prefixed in prod / bare in dev), and the `?oidc=` param equals the interaction uid from the route path — the preserved login fallback.
- Added helpers `chainTargetsInteractionRoute` and `interactionRouteHop`.

## Verification

Live-service integration tests. The environment here has **no running run.auth IdP** (`localhost:3002` unreachable), **no acquired cookie jars** (`.auth/` absent; acquisition needs live AWS/S3 email + ALTCHA), and OIDC client ids are not exported — so a real green cannot be produced without fabricating one. Per the plan's guidance and the phase success criteria ("gate on availability rather than forcing a false green"), each case **skips with a clear reason** when its preconditions are absent, matching `session-valid.spec.ts`'s `test.skip(!hasJar, …)` pattern.

What was verified in this environment:
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (strict, NodeNext) after each task.
- `npx playwright test tests/silent-sso.spec.ts --list` → all **5** cases discovered and parse.
- `npx playwright test tests/silent-sso.spec.ts` (Task 2 verify) and `--grep "prompt=none"` (Task 1 verify) → run cleanly, **5 skipped** with the documented `[SKIP] IdP not reachable / OIDC client not configured` reasons. Common preconditions live in a fixture-free `beforeEach` so the browser is never launched when the IdP is unreachable (clean CI skip, no chromium error).

To run for real: `BASE_URL=<running-idp> OIDC_CLIENT_ID=<id> OIDC_REDIRECT_URI=<registered-uri> npx playwright test tests/silent-sso.spec.ts`, with an acquired cookie jar (`setup/acquire-credentials.spec.ts`) for the warm-session cases (A, D).

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 2 — Missing critical correctness] Warm-session cases must establish the provider `_session`, not rely on `sess_auth` alone**
- **Found during:** Task 1 (Case A design).
- **Issue:** The plan action for Case A says "load a valid session via `loadCookiesForUser` … issue the prompt=none authorize … assert … a `code`". But in oidc-provider, `prompt=none` only succeeds when the **provider `_session`** cookie exists; a cookie jar carrying only the Auth.js `sess_auth` is not sufficient (the provider session is minted when an interaction completes, which — post plan-01 — happens server-side). Asserting `code` off `sess_auth` alone would fail against a real IdP.
- **Fix:** Case A first runs one interactive authorize (`walkRedirects(buildAuthorizeUrl())`) which completes server-side and sets `_session` (shared via `page.request`'s context cookie store), then issues the `prompt=none` request. This matches real warm-browser behavior. Case D asserts that same warm-up completion path directly.
- **Files:** `apps/run.auth/e2e/tests/silent-sso.spec.ts`.
- **Commit:** `1f6261f1`.

**2. [Rule 3 — Blocking, resolved without a new package] client_id / redirect_uri parameterization**
- **Found during:** Task 1.
- **Issue:** Building the authorize URL needs a registered first-party `client_id` and `redirect_uri`, which are deployment-specific env values not present in the e2e shell.
- **Fix:** Parameterized via `OIDC_CLIENT_ID` (fallback `OIDC_RUNHUMAN_CLIENT_ID`) and `OIDC_REDIRECT_URI`, with a dev default `redirect_uri` matching run.human's registered localhost callback. When unset, authorize-based cases skip with a reason. No secrets hardcoded.
- **Files:** `apps/run.auth/e2e/tests/silent-sso.spec.ts`.
- **Commit:** `1f6261f1`.

### Notes (not code deviations)
- Ran `npm install` in `apps/run.auth/e2e` to materialize the already-declared `@playwright/test` devDependency (no new package added; `package.json`/lockfile unchanged). This was needed to run `playwright test --list` and the suite. `node_modules` is gitignored.
- Pre-existing unrelated working-tree changes (`apps/run.flash/webapp/next-env.d.ts`, `apps/run.gpx/webapp/next-env.d.ts`, `apps/run.gpx/webapp/tsconfig.tsbuildinfo`) were left untouched — out of scope for this plan.

## Threat Model Coverage

- **T-33-09 (Elevation of Privilege — silent code without session):** mitigated by test. Case B asserts a sessionless `prompt=none` returns a `login_required`-class error and never a `code`; Case E asserts the unauthenticated interaction still reaches `/login`. Together they are the regression guard that the invisible path cannot mint a code for an unauthenticated user.
- **T-33-SC (Tampering — package installs):** accepted/honored. No new package or e2e project; reuses the existing `@playwright/test` and cookie-jar helpers.

No new security-relevant surface beyond the plan's `<threat_model>`.

## Known Stubs

None. The spec is fully authored with real assertions. The five cases are **availability-gated** (they skip when the live IdP / cookie jar / client config is absent in this environment) — this is a documented, intentional CI behavior per the phase success criteria, not a stub or a fabricated pass.

## Self-Check: PASSED

- `apps/run.auth/e2e/tests/silent-sso.spec.ts` present on disk (380 lines).
- Commits `1f6261f1` and `232a0a25` verified in `git log`.
- `tsc --noEmit` exit 0; `playwright test --list` shows all 5 cases.
