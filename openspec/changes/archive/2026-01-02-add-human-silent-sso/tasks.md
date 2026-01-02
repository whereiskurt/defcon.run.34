# Tasks: Add Silent SSO to run.human

> **Status**: Implementation complete. All tasks verified.

## 1. Create Token Validation Endpoint (run.auth)

- [x] 1.1 Create `/api/session/validate/token` route handler
  - Accept POST with `{ token: string }` body
  - Validate `X-Internal-Secret` header
  - Use NextAuth's `getToken()` to decode and validate JWT
  - Return `{ valid: true, user: {...} }` or `{ valid: false, error: "..." }`

- [x] 1.2 Add `AUTH_INTERNAL_SECRET` environment variable
  - Add to `.secrets.json` and `.secrets.sops.json`
  - Add to service.hcl secrets configuration

## 2. Implement Silent SSO Check (run.human)

- [x] 2.1 Create middleware for URL detection
  - Create `src/middleware.ts`
  - Set `x-url` header with current request URL
  - Configure matcher for relevant routes

- [x] 2.2 Add `hasAuthSession()` function to public layout
  - Read `sess_auth` cookie using Next.js cookies()
  - Call auth server's validation endpoint
  - Use `AUTH_INTERNAL_SECRET` for authorization
  - Return boolean indicating valid session

- [x] 2.3 Implement silent SSO redirect logic in layout
  - Check for existing run.human session → redirect to /dashboard
  - Check URL for autoLogin flag to prevent infinite loops
  - If valid auth session found, redirect to auto-signin route

## 3. Create Auto-signin Route Handler

- [x] 3.1 Create `/api/auth/auto-signin` route handler
  - Accept GET requests
  - Call NextAuth's `signIn("run.defcon.run", { redirectTo: ... })`
  - Handle callbackUrl query parameter

## 4. Configuration Updates

- [x] 4.1 Add `AUTH_INTERNAL_SECRET` to run.human environment
  - Add to `.secrets.json` and `.secrets.sops.json`
  - Add to service.hcl secrets configuration

- [x] 4.2 Update config/index.ts with privateAuthServer URL
  - Configure internal auth server URL for server-to-server calls

## 5. Validation

- [x] 5.1 Test silent SSO flow
  - Log into auth.defcon.run
  - Visit run.defcon.run in new tab
  - Verify automatic redirect to dashboard without clicking login

- [x] 5.2 Test fallback behavior
  - Clear auth.defcon.run cookies
  - Visit run.defcon.run
  - Verify login page displays with sign-in button

- [x] 5.3 Verify no infinite loops
  - Test that invalid/expired tokens don't cause redirect loops
  - Verify URL detection prevents re-checking on autoLogin routes

## Implementation Notes

### Files Created/Modified

**run.auth:**
- `src/app/api/session/validate/token/route.ts` - Token validation endpoint

**run.human:**
- `src/middleware.ts` - URL detection middleware
- `src/app/(public)/layout.tsx` - Silent SSO check
- `src/app/api/auth/auto-signin/route.ts` - Auto-signin route

### Testing Commands

```bash
# Test token validation endpoint
curl -X POST https://auth.defcon.run/use1/api/session/validate/token \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $AUTH_INTERNAL_SECRET" \
  -d '{"token": "..."}'
```
