---
phase: 01-app-scaffold-device-picker
plan: 01
subsystem: ui
tags: [next.js, heroui, tailwind, oidc, auth, react, dark-theme]

# Dependency graph
requires: []
provides:
  - Next.js 16 app shell at apps/run.flash/webapp with dark theme
  - OIDC authentication via auth.defcon.run with flash client registration
  - Service-specific cookies (sess_flash, csrf_flash, callback_flash, state_flash)
  - DCR34 brand fonts and glass-card/noise-overlay/matrix-text CSS system
affects: [01-02, 02-firmware-flash, 03-config-api, 04-deployment]

# Tech tracking
tech-stack:
  added: [next.js 16, heroui 2.8, tailwind 4, next-auth 5-beta.30, framer-motion, lucide-react, clsx]
  patterns: [oidc-auth-config, service-specific-cookies, regional-basepath, noise-overlay-layout]

key-files:
  created:
    - apps/run.flash/webapp/package.json
    - apps/run.flash/webapp/src/config/auth.ts
    - apps/run.flash/webapp/src/middleware.ts
    - apps/run.flash/webapp/src/app/layout.tsx
    - apps/run.flash/webapp/src/app/providers.tsx
    - apps/run.flash/webapp/src/app/signin/page.tsx
    - apps/run.flash/webapp/src/styles/globals.css
    - apps/run.flash/webapp/tailwind.config.js
    - apps/run.flash/webapp/next.config.ts
  modified:
    - apps/run.auth/webapp/src/config/index.ts
    - apps/run.auth/webapp/src/config/oidc.ts

key-decisions:
  - "No service claim check for flash app -- all authenticated DCR34 users can access the flasher"
  - "Omitted mapboxPublicToken from flash auth claims -- not needed for firmware flasher"
  - "Added matrix-green (#00ff41) accent and cyber-border CSS for hacker/cyberpunk aesthetic"

patterns-established:
  - "OIDC client pattern: copy run.gpx auth.ts, swap port/cookies/logging prefix"
  - "Flash app layout: no Header/Footer/MapBackground -- wizard-only shell with noise-overlay"

requirements-completed: [BRWS-02]

# Metrics
duration: 6min
completed: 2026-02-28
---

# Phase 1 Plan 1: App Scaffold + Auth Summary

**Next.js 16 app with HeroUI dark theme, OIDC auth via auth.defcon.run, and flash client registration in run.auth**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-28T13:56:12Z
- **Completed:** 2026-02-28T14:02:13Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments
- Bootstrapped Next.js 16 app at apps/run.flash/webapp with standalone output and regional basePath
- Full HeroUI dark theme with DCR34 teal primary (#00d4aa), matrix-green accent, and glass-card/noise-overlay CSS
- OIDC authentication with auth.defcon.run including JWT claims refresh, lockout detection, and session invalidation
- Flash tool registered as OIDC client in run.auth with all production and dev redirect URIs

## Task Commits

Each task was committed atomically:

1. **Task 1: Bootstrap Next.js 16 app with deps, configs, theme, and layout** - `4ff3047` (feat)
2. **Task 2: OIDC authentication with auth.defcon.run and client registration** - `a033ee9` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/package.json` - Next.js 16 project with all dependencies
- `apps/run.flash/webapp/tsconfig.json` - TypeScript config with @/* path alias
- `apps/run.flash/webapp/next.config.ts` - Standalone output, regional basePath/assetPrefix
- `apps/run.flash/webapp/tailwind.config.js` - HeroUI dark theme with DCR34 colors and matrix-green
- `apps/run.flash/webapp/postcss.config.mjs` - Tailwind 4 PostCSS config
- `apps/run.flash/webapp/eslint.config.mjs` - ESLint 9 flat config for Next.js
- `apps/run.flash/webapp/src/styles/globals.css` - Glass-card, noise-overlay, matrix-text, cyber-border CSS
- `apps/run.flash/webapp/src/config/fonts.ts` - DCR34 brand fonts (Fira Code, Inter, MuseoModerno, Atkinson)
- `apps/run.flash/webapp/src/config/site.ts` - Site metadata for flash.defcon.run
- `apps/run.flash/webapp/src/config/auth.ts` - OIDC client config with JWT callbacks and claims refresh
- `apps/run.flash/webapp/src/app/providers.tsx` - HeroUI + NextThemes providers
- `apps/run.flash/webapp/src/app/layout.tsx` - Root layout with SessionProvider and noise-overlay
- `apps/run.flash/webapp/src/app/page.tsx` - Minimal placeholder page
- `apps/run.flash/webapp/src/app/signin/page.tsx` - Auto-redirect to OIDC provider
- `apps/run.flash/webapp/src/app/api/auth/[...nextauth]/route.ts` - Auth.js catch-all route
- `apps/run.flash/webapp/src/middleware.ts` - Auth middleware protecting all routes
- `apps/run.auth/webapp/src/config/index.ts` - Added flashTool client credentials
- `apps/run.auth/webapp/src/config/oidc.ts` - Added flash tool OIDC client registration

## Decisions Made
- No service claim check for flash app -- all authenticated DCR34 users can use the flasher (unlike gpxstudio which requires a specific service claim)
- Omitted mapboxPublicToken from flash auth claims since firmware flasher has no map component
- Added matrix-green (#00ff41) accent color and cyber-border CSS class for hacker/cyberpunk aesthetic specific to the flasher tool

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Local dev uses .env.local with placeholder credentials.

## Next Phase Readiness
- App shell is ready for the browser gate and device picker wizard (Plan 02)
- OIDC authentication is fully wired -- users visiting flash.defcon.run will be redirected to auth.defcon.run
- DCR34 visual system is in place with dark theme, fonts, and CSS utilities
- No blockers for Plan 02

---
*Phase: 01-app-scaffold-device-picker*
*Completed: 2026-02-28*
