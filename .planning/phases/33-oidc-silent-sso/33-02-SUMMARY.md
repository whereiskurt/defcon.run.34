---
phase: 33-oidc-silent-sso
plan: 02
subsystem: auth
tags: [oidc, next-auth, silent-sso, prompt-none, iframe, postmessage, rp]

# Dependency graph
requires:
  - phase: 33-oidc-silent-sso (plan 01)
    provides: "IdP server-side interaction route + loadExistingGrant auto-consent + remember:true — makes prompt=none silent authorize succeed and the redirect fallback invisible"
provides:
  - "Canonical RP silent-SSO client unit in run.gpx (5 literal-free files): pure helper module, prompt=none initiator route, origin-checked /silent-callback postMessage bridge, hidden-iframe SilentSSO host gated on useSession, redirect auto-signin fallback"
  - "gpx app-shell wiring: SilentSSO mounted in Providers; config/auth.ts pages.error routed to the silent-callback bridge"
affects: [33-03 (byte-identical copy into flash/bib), 33-04, 33-05 (RP unit tests + parity test), 33-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hidden 0x0 aria-hidden iframe prompt=none probe with same-origin postMessage bridge"
    - "resolveSilentStatus keyed on ABSENCE of the next-auth error param (next-auth consumes code at its own callback), NOT on presence of a code param"
    - "App-agnostic unit files: zero app-specific literals (no gpx/whoami); region from window path / REGION_SHORT, origin from window.location.origin, provider id shared literal run.defcon.run"

key-files:
  created:
    - apps/run.gpx/webapp/src/lib/silent-sso.ts
    - apps/run.gpx/webapp/src/app/api/auth/silent-signin/route.ts
    - apps/run.gpx/webapp/src/app/api/auth/auto-signin/route.ts
    - apps/run.gpx/webapp/src/app/silent-callback/page.tsx
    - apps/run.gpx/webapp/src/components/SilentSSO.tsx
  modified:
    - apps/run.gpx/webapp/src/app/providers.tsx
    - apps/run.gpx/webapp/src/config/auth.ts

key-decisions:
  - "Confirmed next-auth@5 (@auth/core beta.31) error contract against installed source: failure redirects to pages.error with ?error=<AuthErrorType>; success lands param-less. resolveSilentStatus keys success on absence of the error param."
  - "Honored the LOCKED CONTRACT: login_required -> stay-logged-out; redirect fallback armed ONLY on timeout. Did NOT implement spec Data-Flow Case 2 (login_required -> immediate redirect)."
  - "Initiator/fallback routes build the region prefix from isDev/REGION_SHORT server-side (matching run.human analog); client files derive region from window.location.pathname via the shared regex helper."
  - "Fallback route defaults callbackUrl to the region ROOT (/ or /${REGION_SHORT}/), never run.human's /whoami — that path does not exist in gpx/flash/bib."

patterns-established:
  - "Parity unit boundary: the 5 unit files are literal-free and byte-identical-ready; providers.tsx + config/auth.ts are app-specific glue explicitly outside the byte-identical set."
  - "Security invariant: bridge postMessage targets window.location.origin (never '*'); parent acts only when decideParentAction confirms event.origin === window.location.origin AND message type matches."

requirements-completed: [SSO-04]

coverage:
  - id: D1
    description: "Pure app-agnostic silent-sso helper module (resolveSilentStatus keyed on error-param absence, decideParentAction origin+type gated, region helpers, message-type/timeout constants)"
    requirement: "SSO-04"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit -p apps/run.gpx/webapp/tsconfig.json"
        status: pass
      - kind: other
        ref: "grep gate: no 'gpx'/'whoami' literal across the 5 unit files"
        status: pass
    human_judgment: true
    rationale: "Runtime prompt=none success/negative mapping and the same-origin postMessage handshake are only fully proven by the plan-05 RP unit tests + Playwright e2e (not authored in this plan); tsc + grep gates prove shape, not the live OIDC contract."
  - id: D2
    description: "prompt=none initiator route + redirect auto-signin fallback route (region-root default, no /whoami)"
    requirement: "SSO-04"
    verification:
      - kind: unit
        ref: "grep 'prompt: \"none\"' silent-signin/route.ts; npm run build (routes appear in App Router table)"
        status: pass
    human_judgment: true
    rationale: "Server-side signIn redirect behavior against the live IdP requires integration/e2e coverage deferred to plan 05."
  - id: D3
    description: "Same-origin /silent-callback postMessage bridge (explicit origin, top-level fall-through to /signin)"
    requirement: "SSO-04"
    verification:
      - kind: unit
        ref: "grep 'window.location.origin' silent-callback/page.tsx; tsc pass"
        status: pass
    human_judgment: true
    rationale: "Cross-frame postMessage delivery and origin targeting need jsdom unit + e2e coverage (plan 05)."
  - id: D4
    description: "Hidden-iframe SilentSSO host gated on useSession()==unauthenticated, origin-checked message routing, timeout -> fallback with current-path callbackUrl"
    requirement: "SSO-04"
    verification:
      - kind: unit
        ref: "grep 'aria-hidden'+'useSession'; tsc pass; npm run build pass"
        status: pass
    human_judgment: true
    rationale: "The unauthenticated-gating, timeout teardown, and login_required stay-logged-out behavior require jsdom/e2e assertions authored in plan 05."
  - id: D5
    description: "gpx shell wiring: SilentSSO mounted in Providers; config/auth.ts pages.error -> region-prefixed /silent-callback"
    requirement: "SSO-04"
    verification:
      - kind: unit
        ref: "grep 'SilentSSO' providers.tsx; grep 'silent-callback' config/auth.ts; npm run build pass"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-04
status: complete
---

# Phase 33 Plan 02: RP Silent-SSO Client Unit (run.gpx canonical) Summary

**Authored the canonical hidden-iframe prompt=none silent-SSO client unit in run.gpx — a literal-free pure helper module, an origin-checked /silent-callback postMessage bridge, a useSession-gated iframe host with a 4.5s timeout fallback, plus initiator + region-root redirect fallback routes — and wired it into the gpx shell (Providers mount + pages.error → bridge).**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-04
- **Completed:** 2026-07-04
- **Tasks:** 3
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- Confirmed the real next-auth@5 success signal against installed `@auth/core` source (`Response.redirect(...?error=<type>)` on failure; param-less landing on success) and encoded `resolveSilentStatus` to key success on the ABSENCE of the `error` param — not on a `code` param.
- Built the 5-file canonical RP unit with zero app-specific literals (grep-gated: no `gpx`, no `whoami`), so plan 03 can copy them byte-for-byte into flash and bib.
- Enforced the security invariant end-to-end: bridge posts to `window.location.origin` only; parent acts only via `decideParentAction` after an `event.origin` + message-type check.
- Honored the LOCKED CONTRACT: `login_required` → stay-logged-out; redirect fallback armed ONLY on timeout (did not implement the contradictory spec Data-Flow Case 2).
- `tsc --noEmit` and `next build` both green in run.gpx/webapp; new routes `/api/auth/silent-signin`, `/api/auth/auto-signin` and page `/silent-callback` present in the App Router table.

## Task Commits

Each task was committed atomically:

1. **Task 1: pure helper module + initiator/fallback routes** - `1528e138` (feat) then `d7455837` (style: strip app names from a comment to satisfy the app-agnostic grep gate)
2. **Task 2: /silent-callback bridge + SilentSSO iframe host** - `23230ec0` (feat)
3. **Task 3: mount SilentSSO in Providers + pages.error → bridge** - `c4bc46ba` (feat)

## Files Created/Modified
- `apps/run.gpx/webapp/src/lib/silent-sso.ts` - Pure app-agnostic helpers: `resolveSilentStatus`, `decideParentAction`, `regionFromPath`, `silentCallbackPath`, `SILENT_SSO_MESSAGE_TYPE`, `SILENT_SSO_TIMEOUT_MS` (4500), `SilentStatus` type. No next-auth / config imports.
- `apps/run.gpx/webapp/src/app/api/auth/silent-signin/route.ts` - `prompt=none` initiator; `signIn("run.defcon.run", { redirectTo }, { prompt: "none" })`.
- `apps/run.gpx/webapp/src/app/api/auth/auto-signin/route.ts` - Redirect fallback; region-root default callbackUrl (no `/whoami`).
- `apps/run.gpx/webapp/src/app/silent-callback/page.tsx` - Same-origin postMessage bridge; top-level fall-through to `/signin`.
- `apps/run.gpx/webapp/src/components/SilentSSO.tsx` - Hidden aria-hidden 0x0 iframe probe gated on `useSession()==unauthenticated`; timeout → fallback with current-path `callbackUrl`.
- `apps/run.gpx/webapp/src/app/providers.tsx` - Mounts `<SilentSSO />` inside `SessionProvider` (app-specific glue).
- `apps/run.gpx/webapp/src/config/auth.ts` - Adds `pages.error` → region-prefixed `/silent-callback`; preserves `pages.signIn`.

## Decisions Made
- **Success signal confirmed from source, not guessed.** `@auth/core` (beta.31, matching gpx's next-auth beta.30) builds every failure redirect as `${origin}${pagePath}?${new URLSearchParams({ error: type })}`; success redirects to `redirectTo` param-less. Hence `resolveSilentStatus` returns `success` when no `error` param (and no raw OIDC negative key) is present, `login_required` otherwise.
- **Region derivation split by context:** server routes use `isDev`/`REGION_SHORT` (run.human analog); client files use the `/^(use1|cac1|usw2|euw1)$/` path regex helper. Keeps the unit literal-free.
- **LOCKED contract over spec prose:** `decideParentAction` maps `login_required` → `stay-logged-out`; only the timeout path navigates to the fallback route.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed run.gpx/webapp node_modules**
- **Found during:** Task 1 (before first verify)
- **Issue:** `apps/run.gpx/webapp` had no `node_modules`, so the plan's `npx tsc --noEmit` / `npm run build` verify gates could not run. This is dependency install of the app's OWN pinned lockfile, not adding a new package.
- **Fix:** Ran `npm ci` (Node 23.6.0 per the prior-wave env note) from the existing `package-lock.json` — 485 packages, no lockfile change.
- **Files modified:** none tracked (node_modules is gitignored)
- **Verification:** `npx tsc --noEmit` and `npm run build` subsequently ran green.
- **Committed in:** n/a (no tracked change)

**2. [Rule 1 - Bug] Removed app names from a helper doc comment to satisfy the app-agnostic gate**
- **Found during:** Task 1 (post-commit literal recheck)
- **Issue:** The `lib/silent-sso.ts` header comment listed "(gpx / flash / bib)", which trips Task 2's `! grep -qi "gpx"` app-agnostic gate on the five unit files.
- **Fix:** Reworded the comment to name no apps; re-ran the grep gate clean.
- **Files modified:** apps/run.gpx/webapp/src/lib/silent-sso.ts
- **Verification:** `grep -i gpx` across the five unit files returns nothing.
- **Committed in:** `d7455837`

---

**Total deviations:** 2 (1 blocking env setup, 1 gate-compliance fix)
**Impact on plan:** Both necessary to satisfy the plan's own verify/grep gates. No scope creep; no behavior change beyond a comment edit.

## Issues Encountered
None beyond the deviations above. `next build` succeeded despite the gpx-studio frontend bundle not being pre-built (the Next app build does not depend on it).

## Known Stubs
None. All five unit files carry live logic; no placeholder/mock data paths.

## User Setup Required
None - no external service configuration required for this plan.

## Next Phase Readiness
- The 5 unit files are literal-free and ready for byte-identical copy into `run.flash` and `run.bib` (plan 03).
- RP unit tests + parity test (plan 05) still needed to prove the runtime prompt=none mapping, the same-origin postMessage handshake, the useSession gating, and the timeout→fallback path (all marked `human_judgment: true` in coverage).
- Full silent-SSO e2e on gpx (plan 05/06) will exercise the warm-session invisible-iframe path against the plan-01 IdP changes.

## Self-Check: PASSED

All 5 created unit files present on disk; all 3 task commits (`d7455837`, `23230ec0`, `c4bc46ba`) present in git history.

---
*Phase: 33-oidc-silent-sso*
*Completed: 2026-07-04*
