---
phase: 33-oidc-silent-sso
verified: 2026-07-04T05:41:27Z
status: human_needed
score: 8/8 requirements code-verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "A warm-session visit to an RP (gpx/flash/bib) shows the authenticated view with the top-level URL never changing, no /login render, and the app session cookie (sess_gpx/flash/bib) set via the hidden iframe — the end-to-end invisible/silent runtime behavior (SSO-08)"
    test: "Bring up run.auth (PORT=3002) + run.gpx (PORT=3003) + run.flash + run.bib with a warm run.auth cookie jar, then run the gated e2e: cd apps/run.gpx/e2e && npx playwright test silent-sso.spec.ts (warm + logged-out), and the flash/bib smoke specs."
    expected: "Warm: authenticated view renders, top-level URL never navigates to /login, sess_gpx established via iframe, no redirect loop. Logged-out: parent stays logged-out, no app session minted, no oscillation."
    why_human: "Requires a live IdP + RP stack and a warm session cookie jar. No servers run in this headless sandbox, so the state-transition invariant (warm _session -> silent code -> authed view, zero top-level nav) cannot be exercised here. Code, wiring, and unit/parity tests are all verified; only the live runtime proof remains."
human_verification:
  - test: "Live warm-session e2e run (SSO-08): dev servers up + warm run.auth cookie jar, run apps/run.gpx/e2e/silent-sso.spec.ts (full) + flash/bib smoke specs."
    expected: "Top-level URL never changes to /login; authenticated view appears; app session cookie set via iframe; logged-out case stays logged-out with no loop."
    why_human: "Needs a running IdP+RP stack + warm session; not executable headlessly. Specs are correctly gated to skip when preconditions are absent."
  - test: "Live IdP integration run (SSO-06): run.auth reachable (PORT=3002) + OIDC client config env, run apps/run.auth/e2e/tests/silent-sso.spec.ts."
    expected: "prompt=none + live provider session -> 302 with code, no interaction render; prompt=none + no session -> login_required; interactions.url resolves to the interaction route; authenticated interaction completes without rendering /login; unauthenticated still reaches /login."
    why_human: "Requires a live provider session and OIDC client config unavailable in this sandbox; the suite skips itself when the IdP is unreachable."
---

# Phase 33: OIDC Silent SSO — Verification Report

**Phase Goal:** Make the OIDC redirect flow invisible for an already-authenticated user and let an RP obtain an authorization code silently once the user is logged in anywhere under `*.defcon.run`, preserving full OIDC semantics. Approach A: invisible IdP interaction + hidden-iframe `prompt=none` in the three NextAuth RPs (gpx, flash, bib). `run.cms` out of scope.
**Verified:** 2026-07-04T05:41:27Z
**Status:** human_needed (passed-with-follow-ups: all code implemented, wired, and unit/parity-tested green; the live invisible/silent runtime behavior needs a running stack)
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal decomposes into an IdP-side mechanism (invisible interaction + persistent, auto-consenting SSO session) and an RP-side mechanism (hidden-iframe `prompt=none` silent check). Every code artifact for both is present, substantive, and correctly wired; the pure-logic and parity tests execute green; the IdP integration and cross-RP e2e specs exist and are correctly gated to skip without a live stack. The only thing not provable in this headless sandbox is the end-to-end runtime invisibility (SSO-08 live warm-session run), which is routed to human verification.

### Observable Truths (per requirement)

| # | Requirement | Status | Evidence |
| --- | ----------- | ------ | -------- |
| SSO-01 | Repoint `interactions.url` to the server interaction route | ✓ VERIFIED | `oidc.ts:310-321` returns `/${config.region}/api/oidc/interaction/${uid}` (dev: `/api/oidc/interaction/…`), no longer `config.urls.loginPage`. Path derived from `config.region`, outside `oidc.routePrefix`, mirroring `[uid].ts` `loginPath`. |
| SSO-02 | Custom `loadExistingGrant` auto-consents first-party allowlist, `undefined` for unknown | ✓ VERIFIED (behavioral) | `load-existing-grant.ts` implements mint/reuse/undefined; wired in `oidc.ts:331-341` with allowlist `Object.values(config.oidc.clients).map(c=>c.clientId)` (single source) and a real `oidc.Grant` mint. Real module run behaviorally: 4/4 cases pass (unknown→undefined & no mint; no-account→undefined; mint+record+return with scope; reuse existing, no mint). `load-existing-grant.test.ts` 4/4 green under Node 23.6.0. |
| SSO-03 | `remember:true` persists provider `_session` | ✓ VERIFIED | `[uid].ts:102` (login branch) and `[uid].ts:125` (unknown-prompt fallback branch) both set `remember: true`; consent branch (`108-117`) untouched — exactly the two login branches the spec names. |
| SSO-04 | RP hidden-iframe silent-SSO unit, authored once | ✓ VERIFIED (behavioral) | Five files present & substantive in run.gpx. `SilentSSO.tsx` injects a 0×0 aria-hidden iframe gated on `useSession()` status `=== "unauthenticated"` (never when authenticated/loading), origin-checked via `decideParentAction`, ~4.5s timeout → auto-signin fallback with current-path `callbackUrl` (never `/whoami`). `silent-signin/route.ts` calls `signIn("run.defcon.run", { redirectTo: silent-callback }, { prompt: "none" })`. `silent-callback/page.tsx` posts `{type:"silent-sso",status}` to `window.parent` targeting `window.location.origin` (never `*`). `resolveSilentStatus` keys success on ABSENCE of `error` param (not on `code`); login_required stays logged-out (spec Case 2 auto-fallback correctly NOT wired into the parent — stay-logged-out). Real module run behaviorally: 21/21 assertions pass. |
| SSO-05 | Unit placed identically in gpx/flash/bib + parity test | ✓ VERIFIED (behavioral) | md5 of all 5 files IDENTICAL across gpx/flash/bib. `<SilentSSO/>` mounted inside each `SessionProvider` (gpx `providers.tsx:15`, flash `layout.tsx:52`, bib `providers.tsx:38`). Each `config/auth.ts` routes `pages.error → /${region}/silent-callback`. `silent-sso-parity.test.ts` reads files off disk and asserts byte-parity: 5/5 green (25-test suite). |
| SSO-06 | IdP integration tests | ✓ VERIFIED (artifact) / live run → human | `run.auth/e2e/tests/silent-sso.spec.ts` present, 27 assertions across 6 blocks covering all five spec cases (prompt=none+session→code, prompt=none+no session→login_required, interactions.url route resolution, authenticated interaction no /login render, unauthenticated reaches /login). Correctly `test.skip`s the suite when the IdP is unreachable/unconfigured (before any browser launch). Live execution routed to human verification. |
| SSO-07 | RP unit pure-logic tests | ✓ VERIFIED (behavioral) | `silent-sso-unit.test.ts` covers `resolveSilentStatus` (success on error-absence incl. bare `code`, all next-auth error values + raw OIDC negatives → login_required), `decideParentAction` (foreign-origin/wrong-type/null/string → ignore; same-origin success/login_required mapped), timeout in 4000–5000ms. Ran green: run.bib silent-sso suites 25/25 (parity 5 + unit 20) under Node 23.6.0; full run.bib suite 139/139. |
| SSO-08 | e2e: full gpx + smoke flash/bib | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `run.gpx/e2e/silent-sso.spec.ts` (warm + logged-out) enumerates cleanly via `playwright test --list`; flash/bib smoke specs present (8 asserts each). All gated with `test.skip` on missing warm cookie jar / unreachable app, so browsers never launch on skip. The invisible/silent runtime behavior (top-level URL never changes, sess cookie via iframe, no loop) is a live state-transition invariant that cannot be exercised headlessly — routed to human verification (documented manual gate). |

**Score:** 8/8 requirements code-verified (1 runtime behavior — SSO-08 live invisibility — present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `apps/run.auth/webapp/src/config/oidc.ts` | interactions.url repoint + loadExistingGrant wiring | ✓ VERIFIED | Lines 310-321, 331-341 |
| `apps/run.auth/webapp/src/config/load-existing-grant.ts` | DI factory, mint/reuse/undefined | ✓ VERIFIED | Pure, literal-free; 4/4 behavioral |
| `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` | remember:true on both login branches | ✓ VERIFIED | Lines 102, 125; consent untouched |
| `apps/run.gpx/webapp/src/lib/silent-sso.ts` | pure helpers, no app literals | ✓ VERIFIED | resolveSilentStatus/decideParentAction/timeout |
| `.../app/api/auth/silent-signin/route.ts` | prompt=none initiator | ✓ VERIFIED | `signIn(...,{prompt:"none"})` |
| `.../app/api/auth/auto-signin/route.ts` | redirect fallback, callbackUrl | ✓ VERIFIED | Uses current path, region-root default |
| `.../app/silent-callback/page.tsx` | origin-scoped postMessage bridge | ✓ VERIFIED | targets `window.location.origin`, top-level fallthrough |
| `.../components/SilentSSO.tsx` | iframe gated on unauthenticated | ✓ VERIFIED | status guard + origin check + timeout |
| flash/bib copies of the 5 unit files | byte-identical | ✓ VERIFIED | md5 identical |
| `apps/run.auth/e2e/tests/silent-sso.spec.ts` | IdP integration | ✓ VERIFIED (present) | 27 asserts, live-gated |
| `apps/run.bib/webapp/src/__tests__/silent-sso-{parity,unit}.test.ts` | parity + unit | ✓ VERIFIED | 25/25 green |
| `apps/run.{gpx,flash,bib}/e2e/silent-sso*.spec.ts` | e2e full + smoke | ⚠️ PRESENT | gated; live run → human |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `oidc.ts` interactions.url | `interaction/[uid].ts` route | `/${region}/api/oidc/interaction/{uid}` | ✓ WIRED |
| `oidc.ts` loadExistingGrant | `config.oidc.clients` allowlist | `Object.values(...).map(c=>c.clientId)` (single source) | ✓ WIRED |
| `SilentSSO.tsx` | `silent-signin` route | hidden iframe `src` = `/${region}/api/auth/silent-signin` | ✓ WIRED |
| `silent-signin` route | IdP authorize | `signIn("run.defcon.run",{redirectTo:silent-callback},{prompt:"none"})` | ✓ WIRED |
| `silent-callback` bridge | parent listener | `postMessage({type,status}, window.location.origin)` + `decideParentAction` origin check | ✓ WIRED |
| `config/auth.ts` pages.error | `silent-callback` bridge | `/${region}/silent-callback` (in-frame negative landing) | ✓ WIRED |
| `<SilentSSO/>` | SessionProvider | mounted inside provider seam in all 3 apps | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| `resolveSilentStatus` / `decideParentAction` runtime logic (real source) | node 23.6 strip-types harness on `run.bib/.../lib/silent-sso.ts` | 21 passed, 0 failed | ✓ PASS |
| `makeLoadExistingGrant` runtime logic (real source) | node 23.6 strip-types harness on `run.auth/.../load-existing-grant.ts` | 4 passed, 0 failed | ✓ PASS |
| RP silent-SSO parity + unit suite | `vitest run` (Node 23.6.0) in run.bib | Test Files 2/2, Tests 25/25 | ✓ PASS |
| IdP loadExistingGrant suite | `vitest run` (Node 23.6.0) in run.auth | Test Files 1/1, Tests 4/4 | ✓ PASS |
| Full run.bib vitest (regression) | `vitest run` (Node 23.6.0) | 15/15 files, 139/139 tests | ✓ PASS |
| gpx e2e enumerates | `playwright test --list` | warm + logged-out cases listed (23 total in 2 files) | ✓ PASS |
| Byte-parity of 5 unit files across 3 apps | md5 compare | all IDENTICAL | ✓ PASS |
| Live warm-session invisibility (SSO-08) | needs running IdP+RP stack | not runnable headlessly | ? SKIP → human |

Note: The vitest suites fail to load under Node 20.13/20.18/22.1 in this sandbox due to a node_modules ESM/CJS interop bug (`require()` of ESM `std-env` via vite's `config.cjs`). Under Node 23.6.0 (the version the executor documented in 33-05-SUMMARY) they run green. This is an environment/toolchain quirk, not a code defect.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| SSO-01 | 33-01 | ✓ SATISFIED | interactions.url repoint |
| SSO-02 | 33-01 | ✓ SATISFIED | loadExistingGrant + 4/4 tests |
| SSO-03 | 33-01 | ✓ SATISFIED | remember:true × 2 branches |
| SSO-04 | 33-02 | ✓ SATISFIED | 5-file unit + 21/21 behavioral |
| SSO-05 | 33-03, 33-05 | ✓ SATISFIED | byte-parity + parity test green |
| SSO-06 | 33-04 | ✓ SATISFIED (code) / live → human | integration spec present & gated |
| SSO-07 | 33-05 | ✓ SATISFIED | 25/25 unit green |
| SSO-08 | 33-06 | ⚠️ NEEDS HUMAN | e2e specs present & gated; live run is the manual gate |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not implemented" markers in any of the 12 modified source files. No stub returns feeding user-visible output. `return null` in `SilentSSO.tsx` is a correct headless-component render, not a stub.

### Human Verification Required

1. **Live warm-session e2e (SSO-08)** — Bring up run.auth + run.gpx/flash/bib with a warm run.auth cookie jar and run the gated Playwright specs.
   - Expected: top-level URL never changes to /login; authenticated view appears; app session cookie (sess_gpx/flash/bib) set via the hidden iframe; logged-out case stays logged-out with no redirect loop.
2. **Live IdP integration (SSO-06)** — Point BASE_URL at a running IdP with OIDC client config and run `run.auth/e2e/tests/silent-sso.spec.ts`.
   - Expected: prompt=none+session→302 with code (no interaction render); prompt=none+no session→login_required; interactions.url resolves to the interaction route; authenticated interaction completes without /login; unauthenticated reaches /login.

### Gaps Summary

No code gaps. Every locked decision from 33-CONTEXT and the design spec is implemented and correctly wired, and the executable (unit + parity) tests run green (loadExistingGrant 4/4, silent-SSO parity+unit 25/25, full run.bib 139/139) under the documented Node 23.6.0. The single outstanding item is the live warm-session runtime proof of end-to-end invisibility/silent-code (SSO-08) plus the live IdP integration run (SSO-06) — both intentionally gated to skip without a running stack, and explicitly designated as manual follow-up gates. Status is therefore human_needed (passed-with-follow-ups), not gaps_found: nothing is missing or broken in the code; a live environment is required to observe the runtime behavior the tests are written to assert.

---

_Verified: 2026-07-04T05:41:27Z_
_Verifier: Claude (gsd-verifier)_
