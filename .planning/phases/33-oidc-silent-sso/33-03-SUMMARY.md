---
phase: 33-oidc-silent-sso
plan: 03
subsystem: auth
tags: [oidc, next-auth, silent-sso, prompt-none, iframe, postmessage, rp, parity]

# Dependency graph
requires:
  - phase: 33-oidc-silent-sso (plan 02)
    provides: "Canonical literal-free RP silent-SSO unit in run.gpx (5 files) ready for byte-identical placement"
provides:
  - "Byte-identical silent-SSO unit present in all three full-user RPs (gpx, flash, bib) at matching relative paths — verified by a shared SHA-256 across the concatenated 5-file set"
  - "flash shell wiring: <SilentSSO /> mounted in app/layout.tsx inside SessionProvider; config/auth.ts pages.error routed to region-prefixed /silent-callback"
  - "bib shell wiring: <SilentSSO /> mounted in app/providers.tsx inside SessionProvider; config/auth.ts pages.error routed to region-prefixed /silent-callback"
affects: [33-04, 33-05 (parity test guards this placement), 33-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parity unit boundary: 5 literal-free files copied verbatim (cp) across apps; per-app glue (layout/providers mount + pages.error) is the only per-app difference"
    - "flash mounts the probe via layout.tsx; bib mounts via providers.tsx (per 33-PATTERNS.md app-shell shapes)"

key-files:
  created:
    - apps/run.flash/webapp/src/lib/silent-sso.ts
    - apps/run.flash/webapp/src/app/api/auth/silent-signin/route.ts
    - apps/run.flash/webapp/src/app/api/auth/auto-signin/route.ts
    - apps/run.flash/webapp/src/app/silent-callback/page.tsx
    - apps/run.flash/webapp/src/components/SilentSSO.tsx
    - apps/run.bib/webapp/src/lib/silent-sso.ts
    - apps/run.bib/webapp/src/app/api/auth/silent-signin/route.ts
    - apps/run.bib/webapp/src/app/api/auth/auto-signin/route.ts
    - apps/run.bib/webapp/src/app/silent-callback/page.tsx
    - apps/run.bib/webapp/src/components/SilentSSO.tsx
  modified:
    - apps/run.flash/webapp/src/app/layout.tsx
    - apps/run.flash/webapp/src/config/auth.ts
    - apps/run.bib/webapp/src/app/providers.tsx
    - apps/run.bib/webapp/src/config/auth.ts

key-decisions:
  - "Copied the 5 unit files with cp (byte-for-byte) rather than re-typing, guaranteeing the plan-05 parity test passes; a shared SHA-256 across the concatenated set confirms gpx == flash == bib."
  - "Mounted <SilentSSO /> at each app's existing SessionProvider seam (flash: layout.tsx; bib: providers.tsx) as a sibling before {children}, mirroring the gpx providers.tsx wiring."
  - "config/auth.ts pages.error uses each app's own `region` var and the same isDev/region-prefix derivation as pages.signIn — no new literals; signIn preserved intact."

patterns-established:
  - "Per-app glue (mount point + pages.error region literal) is explicitly OUTSIDE the byte-identical unit; only the 5 unit files are parity-guarded."

requirements-completed: [SSO-05]

coverage:
  - id: P1
    description: "5 silent-SSO unit files byte-identical across gpx/flash/bib"
    requirement: "SSO-05"
    verification:
      - kind: other
        ref: "diff of concatenated 5-file set flash-vs-gpx and bib-vs-gpx empty; shared SHA-256 ed2d8bd3... across all three apps"
        status: pass
    human_judgment: false
  - id: P2
    description: "flash shell wired: SilentSSO mounted in layout.tsx; pages.error -> region /silent-callback; build green"
    requirement: "SSO-05"
    verification:
      - kind: unit
        ref: "grep 'SilentSSO' layout.tsx; grep 'silent-callback' config/auth.ts; npm run build (routes /api/auth/silent-signin, /api/auth/auto-signin, /silent-callback in App Router table)"
        status: pass
    human_judgment: false
  - id: P3
    description: "bib shell wired: SilentSSO mounted in providers.tsx; pages.error -> region /silent-callback; build green"
    requirement: "SSO-05"
    verification:
      - kind: unit
        ref: "grep 'SilentSSO' providers.tsx; grep 'silent-callback' config/auth.ts; npm run build (three new routes in App Router table)"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-04
status: complete
---

# Phase 33 Plan 03: Place Silent-SSO Unit in run.flash and run.bib Summary

**Placed the canonical run.gpx silent-SSO unit byte-identically into run.flash and run.bib (verified by a shared SHA-256 across the 5-file set in all three apps), and wired each app's shell — `<SilentSSO />` mounted in flash's layout.tsx and bib's providers.tsx, with each config/auth.ts pages.error routed to its region-prefixed /silent-callback bridge.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-04
- **Completed:** 2026-07-04
- **Tasks:** 2
- **Files modified:** 14 (10 created, 4 modified)

## Accomplishments
- Copied the five literal-free unit files (`lib/silent-sso.ts`, `api/auth/silent-signin/route.ts`, `api/auth/auto-signin/route.ts`, `silent-callback/page.tsx`, `components/SilentSSO.tsx`) from run.gpx into the SAME relative paths under run.flash and run.bib using `cp` — byte-for-byte.
- Confirmed perfect parity: the concatenated 5-file set produces an identical SHA-256 (`ed2d8bd3…`) in gpx, flash, and bib; the plan's per-app `diff` gate is empty for both.
- Re-ran the app-agnostic literal gate over the copied files: no `gpx`/`flash`/`bib`/`whoami` literals leak into the unit.
- Mounted `<SilentSSO />` at each app's existing SessionProvider seam — flash via `app/layout.tsx`, bib via `app/providers.tsx` — as a sibling of `{children}`, mirroring gpx's providers wiring.
- Added `pages.error → region-prefixed /silent-callback` to each app's `config/auth.ts`, reusing the app's own `region`/`isDev` derivation and preserving the existing `pages.signIn`.
- `npm run build` green for both webapps; the three new routes (`/api/auth/silent-signin`, `/api/auth/auto-signin`, `/silent-callback`) appear in each app's App Router table.

## Task Commits

1. **Task 1: place unit in run.flash + wire layout.tsx mount and pages.error** — `46617ee3` (feat)
2. **Task 2: place unit in run.bib + wire providers.tsx mount and pages.error** — `9055184a` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/src/{lib/silent-sso.ts, app/api/auth/silent-signin/route.ts, app/api/auth/auto-signin/route.ts, app/silent-callback/page.tsx, components/SilentSSO.tsx}` — verbatim copies of the gpx canonical unit.
- `apps/run.flash/webapp/src/app/layout.tsx` — import `SilentSSO`; render `<SilentSSO />` inside `SessionProvider`.
- `apps/run.flash/webapp/src/config/auth.ts` — add `pages.error` → region-prefixed `/silent-callback`; `signIn` preserved.
- `apps/run.bib/webapp/src/{lib/silent-sso.ts, app/api/auth/silent-signin/route.ts, app/api/auth/auto-signin/route.ts, app/silent-callback/page.tsx, components/SilentSSO.tsx}` — verbatim copies of the gpx canonical unit.
- `apps/run.bib/webapp/src/app/providers.tsx` — import `SilentSSO`; render `<SilentSSO />` inside `SessionProvider`.
- `apps/run.bib/webapp/src/config/auth.ts` — add `pages.error` → region-prefixed `/silent-callback`; `signIn` preserved.

## Decisions Made
- **Copy via `cp`, not re-typing.** Guarantees byte-identical placement so plan 05's parity test passes deterministically; a shared SHA-256 across all three apps is the proof.
- **Per-app mount seam honored.** flash exposes its `SessionProvider` in `layout.tsx`, bib in `providers.tsx` — the probe was mounted at each app's actual seam rather than forcing a uniform file, since the mount point is app-shell glue explicitly outside the parity unit.
- **pages.error mirrors pages.signIn derivation.** Reused each app's existing `region`/`isDev` pattern; no new literals introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed run.flash/webapp and run.bib/webapp node_modules**
- **Found during:** Task 1 and Task 2 (before the `npm run build` verify gates)
- **Issue:** Neither webapp had `node_modules`, so the plan's `npm run build` verify gate could not run. This is install of each app's OWN pinned lockfile, not adding a new package (threat register T-33-SC: no packages installed).
- **Fix:** Ran `npm ci` from each existing `package-lock.json` under Node 23.6.0 (nvm), per the prior-wave env note that these webapps need Node ≥22.12/23. No lockfile change.
- **Files modified:** none tracked (node_modules is gitignored).
- **Verification:** `npm run build` subsequently ran for both apps.

**2. [Rule 3 - Blocking] Injected a placeholder NEXT_PUBLIC_FIRMWARE_VERSION for the flash verify build only**
- **Found during:** Task 1 (flash `npm run build`)
- **Issue:** flash's `next.config.ts` throws in production builds when `NEXT_PUBLIC_FIRMWARE_VERSION` is unset (a pre-existing flash build guard for firmware injection, unrelated to silent-SSO). Without it the plan's build gate cannot run.
- **Fix:** Set `NEXT_PUBLIC_FIRMWARE_VERSION="0.0.0-verify"` in the build shell env only — no tracked file changed. This is verification-only; it lets the TS/TSX (including the new silent-SSO code) compile and the App Router table render.
- **Files modified:** none.
- **Verification:** flash build compiled successfully with the three new routes present.

---

**Total deviations:** 2 (both blocking env setup for the verify gates; no code/scope change).
**Impact on plan:** Both were necessary to run the plan's own `npm run build` gates. No behavior change; the firmware env var is a flash-specific pre-existing requirement, not silent-SSO scope.

## Issues Encountered
None beyond the deviations above. Both builds succeeded; parity is exact (shared SHA-256 across gpx/flash/bib).

## Known Stubs
None. All copied files carry the live logic authored in plan 02; no placeholder/mock data paths.

## User Setup Required
None — no external service configuration required for this plan. (The flash firmware env var is a build-time concern handled by the Dockerfile/CI, not a silent-SSO runtime dependency.)

## Next Phase Readiness
- The 5 unit files are now byte-identical in gpx, flash, and bib — plan 05's parity test has a stable, verified baseline to guard.
- RP unit tests + the parity test (plan 05) still needed to prove the runtime prompt=none mapping, the same-origin postMessage handshake, useSession gating, and the timeout→fallback path.
- flash/bib silent-SSO smoke e2e (plan 05/06) can now exercise the warm-session invisible-iframe path in all three apps.

## Self-Check: PASSED

All 10 created unit files present on disk in flash and bib; both task commits (`46617ee3`, `9055184a`) present in git history; three-way SHA-256 parity confirmed (`ed2d8bd3…`).

---
*Phase: 33-oidc-silent-sso*
*Completed: 2026-07-04*
