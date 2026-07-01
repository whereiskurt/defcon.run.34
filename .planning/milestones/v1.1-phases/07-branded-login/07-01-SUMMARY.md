---
phase: 07-branded-login
plan: 01
subsystem: ui
tags: [html, css, nginx, branding, sso, error-pages]

# Dependency graph
requires:
  - phase: none
    provides: n/a
provides:
  - DCR34-branded login page at cms.defcon.run root
  - Branded error pages for all SSO failure paths
  - Static asset serving (background images) via nginx
affects: [run.cms deployment, SSO error UX]

# Tech tracking
tech-stack:
  added: [MuseoModerno font via Google Fonts]
  patterns: [embedded CSS for self-contained HTML pages, renderBrandedError for consistent SSO error UX]

key-files:
  created:
    - apps/run.cms/nginx/bg/vegas-z10.png
  modified:
    - apps/run.cms/nginx/index.html
    - apps/run.cms/nginx/nginx.conf
    - apps/run.cms/nginx/Dockerfile.nginx
    - apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts

key-decisions:
  - "Single background image (vegas-z10.png) to keep container small"
  - "All CSS embedded inline -- no external stylesheets or Tailwind CDN"
  - "Error pages omit Vegas background since served by Strapi not nginx"

patterns-established:
  - "renderBrandedError: reusable branded error HTML generator with XSS protection"
  - "Glass-card visual identity: #0a0a0f bg, rgba(17,17,24,0.8) card, #00d4aa teal, MuseoModerno font"

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 7 Plan 1: Branded Login Summary

**DCR34-branded CMS login page with glass-card layout, Vegas background, teal accents, and branded error pages for all five SSO failure paths**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T17:55:25Z
- **Completed:** 2026-03-02T17:58:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced bare 10-line placeholder HTML with full DCR34-branded login page matching auth.defcon.run visual identity
- Added nginx static serving for background images with 30-day cache headers
- Replaced all 5 raw `renderSignUpError` calls with branded error pages featuring glass-card layout and clear user messages
- XSS protection via HTML escaping on all error title/message content

## Task Commits

Each task was committed atomically:

1. **Task 1: Create branded login page with nginx static serving** - `1e02ee7` (feat)
2. **Task 2: Add branded error pages to SSO extension** - `cd5cd16` (feat)

**Plan metadata:** `ed8aa8f` (docs: complete plan)

## Files Created/Modified
- `apps/run.cms/nginx/index.html` - DCR34-branded login page with embedded CSS, region detection, sign-in button
- `apps/run.cms/nginx/bg/vegas-z10.png` - Vegas city view background image (copied from run.auth)
- `apps/run.cms/nginx/nginx.conf` - Added `location = /` and `location /bg/` blocks for static serving
- `apps/run.cms/nginx/Dockerfile.nginx` - Added `COPY bg/` line to include background images in container
- `apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts` - Added `renderBrandedError` function, replaced all 5 error rendering calls

## Decisions Made
- Used single background image (vegas-z10.png, city zoom level) to minimize container size
- All CSS embedded inline in HTML files -- no external dependencies ensures pages load independently
- Error pages served by Strapi omit the Vegas background image since they don't have access to nginx static paths; dark background with glass-card provides sufficient visual branding
- Access denied error shows "Back to Login" (not "Try Again") since retrying with the same account will be denied again

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CMS branded login page ready for deployment
- Error pages will activate immediately for all SSO failure scenarios
- Container rebuild required to include background image in nginx layer

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 07-branded-login*
*Completed: 2026-03-02*
