---
phase: 33-oidc-silent-sso
plan: 06
subsystem: e2e (browser-level silent-SSO verification)
tags: [oidc, silent-sso, prompt-none, iframe, playwright, e2e, warm-session, no-loop]

# Dependency graph
requires:
  - phase: 33-oidc-silent-sso (plan 01)
    provides: "IdP interactions.url repoint + loadExistingGrant auto-consent + remember:true — the warm-session invisible invariant cannot hold without it"
  - phase: 33-oidc-silent-sso (plan 02)
    provides: "Canonical RP silent-SSO unit in run.gpx (hidden-iframe SilentSSO, /silent-callback bridge, initiator + fallback routes)"
  - phase: 33-oidc-silent-sso (plan 03)
    provides: "Byte-identical silent-SSO unit placed in run.flash and run.bib"
provides:
  - "Full browser-level silent-SSO e2e on run.gpx: warm-session gate (authed view, no auth /login render, no /signin loop, sess_gpx set via the hidden iframe, real session) + logged-out gate (parent stays logged-out, no redirect loop, no app session minted)"
  - "Smoke silent-SSO e2e packages for run.flash and run.bib mirroring run.gpx/e2e (same pinned @playwright/test + typescript; no new package) — each with a warm-session smoke spec"
affects: [phase 33 verification (SSO-08), T-33-11 (no-loop regression guard), T-33-12 (no silent session without server session)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Main-frame-only navigation tracking via page.on('framenavigated') filtered on frame === page.mainFrame() — asserts the top-level URL sequence while ignoring the hidden probe's child-frame navigations"
    - "Availability gating in a FIXTURE-FREE beforeEach (no page/context) so Playwright never launches the browser when preconditions are absent — clean CI skip, no chromium-missing error"
    - "Silent-SSO liveness gate requires BOTH the app AND the run.auth IdP reachable (stackReachable) — the prompt=none flow cannot complete without the IdP"
    - "flash/bib e2e cookie-jar loader is byte-identical to gpx's — the run.auth jar resolves via the same ../../../run.auth/e2e relative path"

key-files:
  created:
    - apps/run.gpx/e2e/silent-sso.spec.ts
    - apps/run.flash/e2e/.gitignore
    - apps/run.flash/e2e/package.json
    - apps/run.flash/e2e/package-lock.json
    - apps/run.flash/e2e/playwright.config.ts
    - apps/run.flash/e2e/tsconfig.json
    - apps/run.flash/e2e/lib/cookie-jar.ts
    - apps/run.flash/e2e/silent-sso-smoke.spec.ts
    - apps/run.bib/e2e/.gitignore
    - apps/run.bib/e2e/package.json
    - apps/run.bib/e2e/package-lock.json
    - apps/run.bib/e2e/playwright.config.ts
    - apps/run.bib/e2e/tsconfig.json
    - apps/run.bib/e2e/lib/cookie-jar.ts
    - apps/run.bib/e2e/silent-sso-smoke.spec.ts
  modified: []

key-decisions:
  - "The forbidden invariant is the auth-service /login RENDER (the exact thing plan-01 makes invisible) plus /signin OSCILLATION (the loop). The RP's transient /signin shell is allowed once as the realistic entry (every gpx/flash/bib route auth-gates to /signin), so the warm assertion is: auth /login count == 0, RP /signin count <= 1, settled off any login/signin page, sess_<app> set via the iframe, real session."
  - "Gate live cases on BOTH app + IdP reachability. Silent SSO fundamentally depends on run.auth; app-only reachability would let a test run against a half-up stack and produce a misleading result. Mirrors 33-04's IdP-reachability gating."
  - "Preconditions live in a fixture-free beforeEach (not an in-body test.skip) so the browser is never launched on skip — otherwise a chromium-missing/CI env fails instead of skipping cleanly."
  - "flash and bib both default BASE_URL to :3004 (each app's own package.json dev port: `next dev -p 3004`); operators override BASE_URL when running them simultaneously."

requirements-completed: [SSO-08]

coverage:
  - id: E1
    description: "gpx warm-session gate — authed view, no auth /login render, no /signin loop, sess_gpx set via the hidden iframe, real session"
    requirement: "SSO-08"
    verification:
      - kind: e2e
        ref: "apps/run.gpx/e2e && npx playwright test silent-sso.spec.ts -g \"warm\" (runs when a warm run.auth cookie jar + live app/IdP are present)"
        status: skipped-here
    human_judgment: true
    rationale: "This is the real SSO-08 gate. In THIS environment there is no warm run.auth cookie jar and run.auth (:3002) is down, so the executed assertion SKIPS with a clear reason. A green `playwright test --list` proves the spec is valid and registered — it does NOT prove SSO-08. The proof is the executed warm-session assertion (dev servers up + a warm cookie jar) or the equivalent manual warm-session run."
  - id: E2
    description: "gpx logged-out gate — parent stays logged-out, no redirect loop, no app session minted by the silent iframe (T-33-11 / T-33-12)"
    requirement: "SSO-08"
    verification:
      - kind: e2e
        ref: "apps/run.gpx/e2e && npx playwright test silent-sso.spec.ts (logged-out case; needs live app + IdP)"
        status: skipped-here
    human_judgment: true
    rationale: "Needs the live app + IdP; run.auth is down here so it skips. Asserts no /signin or /login oscillation and that no sess_gpx / session is minted for an anonymous visitor."
  - id: E3
    description: "flash + bib warm-session smoke — sess_flash / sess_bib set via iframe, no auth /login render, no /signin loop, real session"
    requirement: "SSO-08"
    verification:
      - kind: e2e
        ref: "apps/run.flash/e2e && npx playwright test silent-sso-smoke.spec.ts --list ; apps/run.bib/e2e && … --list"
        status: pass
    human_judgment: true
    rationale: "`--list` discovers each smoke spec (1 test each) and tsc compiles clean; the executed warm smoke skips here (no cookie jar / IdP down) and runs when the app+IdP+jar are present."
  - id: E4
    description: "No new third-party package; flash/bib reuse the exact pinned @playwright/test + typescript and a byte-identical cookie-jar loader (T-33-SC)"
    requirement: "SSO-08"
    verification:
      - kind: other
        ref: "diff of flash/bib e2e/lib/cookie-jar.ts vs gpx == empty; package.json devDependencies identical (@playwright/test ^1.48.0, typescript ^5.6.3)"
        status: pass
    human_judgment: false

# Metrics
duration: ~8min
completed: 2026-07-04
status: complete
---

# Phase 33 Plan 06: Silent-SSO Browser E2E (gpx full + flash/bib smoke) Summary

**Authored the goal-level browser proof of silent SSO: a full run.gpx spec covering the warm-session invariant (authenticated view, the auth `/login` page never rendering, no `/signin` redirect loop, `sess_gpx` established via the hidden prompt=none iframe, a real server session) and the logged-out invariant (parent stays logged-out, no loop, no app session minted), plus minimal mirror e2e packages for run.flash and run.bib each carrying a trimmed warm-session smoke spec — all availability-gated so they skip cleanly (never launching the browser) when the app/IdP/cookie-jar are absent, and all discovered by `playwright test --list` with clean `tsc`.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-07-04
- **Tasks:** 2
- **Files created:** 15 (1 gpx spec + 7 flash e2e + 7 bib e2e)

## Accomplishments
- **gpx full spec** (`apps/run.gpx/e2e/silent-sso.spec.ts`): two tests in the EXISTING run.gpx/e2e package (reuses `@playwright/test` + `loadAuthCookies` — no new dependency).
  - Warm `[warm]`: injects the run.auth session, polls that `sess_gpx` appears (set via the hidden iframe), asserts the auth-service `/login` page never renders, the RP `/signin` shell is transited at most once (no oscillation), the view settles off any login/signin page, and the server confirms a real session.
  - Logged-out: fresh cookieless context, asserts no `/signin` or `/login` oscillation and that the silent iframe mints NO `sess_gpx` and no session (T-33-11 no-loop, T-33-12 no-fabricated-session).
- **flash + bib smoke packages** (`apps/run.flash/e2e`, `apps/run.bib/e2e`): mirror run.gpx/e2e — same pinned `@playwright/test ^1.48.0` + `typescript ^5.6.3` (no new package), copied `tsconfig.json`, `.gitignore`, and a byte-identical `lib/cookie-jar.ts` (the run.auth jar resolves via the same relative path). `playwright.config.ts` default BASE_URL set to each app's dev port (:3004). Each adds a single warm-session `silent-sso-smoke.spec.ts` (sess_flash / sess_bib variant of the gpx warm case).
- **Verified what can be verified here:** `tsc --noEmit` clean in all three packages; `playwright test --list` discovers all four tests (gpx 2, flash 1, bib 1); cookie-jar parity is exact (flash/bib == gpx).

## Task Commits

1. **Task 1: full silent-SSO e2e on run.gpx (warm + logged-out)** — `a5675a66` (test)
2. **Task 2: smoke silent-SSO e2e packages for run.flash and run.bib** — `8408400d` (test)

## Decisions Made
- **Invariant framing.** Every gpx/flash/bib route auth-gates to `/signin`, so a warm user necessarily transits `/signin` once as the entry. The regression the phase guards is (a) the auth-service `/login` HTML RENDERING (plan-01 makes this invisible for a warm user) and (b) OSCILLATION to `/signin`/`/login` and back (the loop). Hence the warm assertion: auth `/login` count `== 0`, RP `/signin` count `<= 1`, settled off login/signin, `sess_<app>` set via the iframe, real session — rather than a naive "never touches /signin", which the app architecture makes impossible.
- **Stack-reachability gate.** Live cases require BOTH the app AND run.auth reachable, because the prompt=none flow cannot complete without the IdP. Mirrors 33-04's IdP-reachability gating and avoids misleading runs against a half-up stack.
- **Fixture-free beforeEach gating.** Preconditions are checked in a `beforeEach` that requests no `page`/`context` fixture, so Playwright never launches the browser on skip — the difference between a clean CI skip and a chromium-missing failure (the initial in-body `test.skip` version crashed on browser launch; moved to `beforeEach`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Availability gate moved from in-body `test.skip` to a fixture-free `beforeEach`**
- **Found during:** Task 1 verify (executing the spec).
- **Issue:** With the skip conditions inside the test body, Playwright launches the browser (fixtures resolve) BEFORE the skip fires. In this environment chromium is not installed, so the "skip" path errored with `browserType.launch: Executable doesn't exist` instead of skipping cleanly.
- **Fix:** Moved all preconditions into a `test.beforeEach(async () => …)` that uses no `page`/`context` fixture, so the browser is never launched when the gate must skip (matches 33-04's fixture-free skip pattern). Split into two describe blocks so each test carries its correct preconditions.
- **Files:** `apps/run.gpx/e2e/silent-sso.spec.ts` (and the same pattern in the flash/bib smoke specs).
- **Commit:** `a5675a66` (and `8408400d` for flash/bib).

**2. [Rule 2 — Missing critical correctness] Gate on app + IdP reachability, not app alone**
- **Found during:** Task 1 verify — a stray dev server was listening on :3003 while run.auth (:3002) was down, so an app-only reachability gate did NOT skip and the test then crashed on browser launch against a stack that cannot complete the silent flow.
- **Fix:** Added `stackReachable()` requiring BOTH `${BASE_URL}/` and `${AUTH_SERVICE_URL}/` (run.auth) to respond; the silent prompt=none flow is meaningless without the IdP. With run.auth down, both gpx cases now skip cleanly.
- **Files:** `apps/run.gpx/e2e/silent-sso.spec.ts`, `apps/run.flash/e2e/silent-sso-smoke.spec.ts`, `apps/run.bib/e2e/silent-sso-smoke.spec.ts`.
- **Commit:** `a5675a66`, `8408400d`.

### Notes (not code deviations)
- Ran `npm install` in each e2e package to materialize the already-declared `@playwright/test`/`typescript` devDependencies (needed for `tsc`/`--list`). No new package added; `node_modules` is gitignored. The generated `package-lock.json` is committed for each new package (mirrors run.gpx/e2e which tracks its lockfile).
- Pre-existing unrelated working-tree changes (`apps/run.flash/webapp/next-env.d.ts`, `apps/run.gpx/webapp/next-env.d.ts`, `apps/run.gpx/webapp/tsconfig.tsbuildinfo`) were left untouched — out of scope.

## SSO-08 Gate Note (READ THIS)

**A green `playwright test --list` does NOT prove SSO-08.** `--list` only proves the specs are valid and registered. The real SSO-08 gate is the EXECUTED warm-session assertion (`-g "warm"`) — authenticated view renders, the auth `/login` page never renders, no `/signin` loop, and `sess_gpx` is set via the hidden iframe — which requires a live run.gpx + run.auth stack AND a warm `run.auth` cookie jar. In THIS environment there is no cookie jar and run.auth (:3002) is down, so every live case SKIPS with an explicit reason (verified: `2 skipped` for gpx, `1 skipped` for flash). To prove SSO-08 for real:

```
cd apps/run.auth/e2e && npm test            # acquire a warm cookie jar (needs AWS/S3 email + ALTCHA)
# with run.gpx + run.auth dev servers up:
cd apps/run.gpx/e2e && npx playwright test silent-sso.spec.ts -g "warm"   # -> WARM_INVARIANT_PROVEN
cd apps/run.flash/e2e && npx playwright test silent-sso-smoke.spec.ts
cd apps/run.bib/e2e && npx playwright test silent-sso-smoke.spec.ts
```

This depends on 33-01 (the IdP change) being live for the warm invariant to hold. This plan does NOT fabricate a green here; per the phase success criteria it gates/skips on availability with clear reasons.

## Threat Model Coverage
- **T-33-11 (DoS — redirect loop for logged-out user):** mitigated by test. The gpx logged-out case asserts no `/signin`/`/login` oscillation.
- **T-33-12 (EoP — silent auth without server session):** mitigated by test. The gpx logged-out case asserts the silent iframe mints no `sess_gpx` and no session for an anonymous visitor.
- **T-33-SC (Tampering — package installs):** accepted/honored. flash/bib e2e reuse the exact pinned `@playwright/test` + `typescript` from run.gpx/e2e and a byte-identical cookie-jar loader — no NEW third-party package.

No new security-relevant surface beyond the plan's `<threat_model>`.

## Known Stubs
None. All four tests carry real assertions. They are **availability-gated** — they skip when the live app/IdP/cookie-jar are absent (documented, intentional CI behavior per the phase success criteria), which is NOT a stub or a fabricated pass. The warm-session executed assertion is the real SSO-08 gate (see the gate note above).

## Self-Check: PASSED

- All 15 created files present on disk (gpx spec + flash/bib e2e packages).
- Commits `a5675a66` and `8408400d` present in git history.
- `tsc --noEmit` exit 0 in all three e2e packages; `playwright test --list` discovers gpx 2 + flash 1 + bib 1; cookie-jar parity exact (flash/bib == gpx); executed suites skip cleanly (no browser launch) here.

---
*Phase: 33-oidc-silent-sso*
*Completed: 2026-07-04*
