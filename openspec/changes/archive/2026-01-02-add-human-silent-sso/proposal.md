# Change: Add Silent SSO to run.human

## Why

When users authenticate at auth.defcon.run first (e.g., via CMS or another service), they should be automatically logged into run.defcon.run without clicking a sign-in button. This creates a seamless SSO experience across the defcon.run ecosystem.

## What Changes

- **NEW** Server-side auth session detection in run.human public layout
- **NEW** Token validation endpoint in run.auth for server-to-server verification
- **NEW** Auto-signin route handler for triggering OIDC flow server-side
- **NEW** Middleware for URL detection to prevent infinite redirects
- **SPEC** New `human-auth` specification for run.human authentication behavior

## Implementation Approach

The silent SSO uses server-to-server token validation:

1. **Cookie Detection**: run.human reads the `sess_auth` cookie (shared across .defcon.run domain)
2. **Token Validation**: run.human calls auth.defcon.run's internal API to validate the JWT
3. **Auto-signin**: If valid, redirects to `/api/auth/auto-signin` which triggers the OIDC flow
4. **Session Creation**: OIDC flow completes, user lands on dashboard with session

This approach avoids:
- Exposing auth secrets to run.human (validation is server-to-server)
- Client-side flickering (all redirects happen server-side)
- Infinite loops (middleware provides URL detection)

## Impact

- **Affected specs**: New `human-auth` specification
- **Affected code**:
  - `apps/run.human/webapp/src/app/(public)/layout.tsx` - Silent SSO check
  - `apps/run.human/webapp/src/app/api/auth/auto-signin/route.ts` - New route
  - `apps/run.human/webapp/src/middleware.ts` - New middleware
  - `apps/run.auth/webapp/src/app/api/session/validate/token/route.ts` - New endpoint
- **Dependencies**: Requires `sess_auth` cookie to be set with `.defcon.run` domain scope
- **Infrastructure changes**: None - uses existing OIDC client configuration
