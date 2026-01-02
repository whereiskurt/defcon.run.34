# Design: Silent SSO for run.human

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser       │     │   run.human      │     │   run.auth      │
│                 │     │   (Next.js)      │     │   (OIDC Server) │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         │ 1. Visit /            │                        │
         │ (with sess_auth cookie)                        │
         ├──────────────────────►│                        │
         │                       │                        │
         │                       │ 2. Read sess_auth      │
         │                       │    cookie              │
         │                       │                        │
         │                       │ 3. POST /api/session/  │
         │                       │    validate/token      │
         │                       ├───────────────────────►│
         │                       │                        │
         │                       │ 4. {valid: true}       │
         │                       │◄───────────────────────┤
         │                       │                        │
         │ 5. 302 Redirect to    │                        │
         │    /api/auth/auto-signin                       │
         │◄──────────────────────┤                        │
         │                       │                        │
         │ 6. GET /api/auth/     │                        │
         │    auto-signin        │                        │
         ├──────────────────────►│                        │
         │                       │                        │
         │ 7. 302 Redirect to    │                        │
         │    OIDC /auth         │                        │
         │◄──────────────────────┤                        │
         │                       │                        │
         │ 8. OIDC flow          │                        │
         ├────────────────────────────────────────────────►│
         │                       │                        │
         │ 9. Auto-completes     │                        │
         │    (session exists)   │                        │
         │◄────────────────────────────────────────────────┤
         │                       │                        │
         │ 10. Callback to       │                        │
         │     run.human         │                        │
         ├──────────────────────►│                        │
         │                       │                        │
         │ 11. Session created   │                        │
         │     (sess_run cookie) │                        │
         │                       │                        │
         │ 12. Redirect to       │                        │
         │     /dashboard        │                        │
         │◄──────────────────────┤                        │
```

## Key Components

### 1. Token Validation Endpoint (run.auth)

**Path**: `/api/session/validate/token`
**Method**: POST
**Security**: Protected by `X-Internal-Secret` header

```typescript
// Request
{
  token: string  // JWT from sess_auth cookie
}

// Response (success)
{
  valid: true,
  user: { id, email, name }
}

// Response (failure)
{
  valid: false,
  error: "unauthorized" | "invalid_token" | "expired" | "missing_token"
}
```

### 2. Silent SSO Check (run.human layout)

Located in `apps/run.human/webapp/src/app/(public)/layout.tsx`:

1. Check for existing run.human session → redirect to /dashboard
2. Read `sess_auth` cookie from request
3. Validate token via server-to-server call to auth
4. If valid, redirect to `/api/auth/auto-signin`

### 3. Auto-signin Route Handler

**Path**: `/api/auth/auto-signin`

Triggers NextAuth's `signIn()` in a Route Handler context (where cookie modification is allowed). This avoids the "Cookies can only be modified in a Server Action" error.

### 4. Middleware for URL Detection

Sets `x-url` header on requests so layouts can detect query parameters (e.g., `?autoLogin=true`) and prevent infinite redirect loops.

## Design Decisions

### Why server-to-server validation?

**Rejected alternatives:**
- **Decode JWT in run.human**: Would require sharing `AUTH_JWT_SECRET` across services
- **Client-side fetch**: `sameSite: "lax"` cookies aren't sent on cross-origin fetch
- **iframe postMessage**: Complex and has security implications

**Chosen approach**: Server-to-server call with internal secret. Clean separation of concerns - auth validates its own tokens.

### Why auto-signin route vs direct OIDC redirect?

NextAuth v5 requires cookie modification to set up OIDC state/CSRF tokens. Server Components can't modify cookies, but Route Handlers can. The auto-signin route is a thin wrapper that calls `signIn()` in the right context.

### Why middleware for URL detection?

Next.js App Router layouts don't have access to searchParams. Middleware can read the URL and pass it via headers. This enables:
- Detecting `?autoLogin=true` to prevent infinite loops
- Detecting if already on `/api/auth/auto-signin` path

## Cookie Scope

The `sess_auth` cookie must be set with domain `.defcon.run` (note the leading dot) to be accessible across subdomains:
- `auth.defcon.run` (sets the cookie)
- `run.defcon.run` (reads the cookie)
- `cms.defcon.run` (could read the cookie)

## Environment Variables

### run.auth
- `AUTH_JWT_SECRET` - JWT signing secret (existing)
- `AUTH_INTERNAL_SECRET` - Secret for server-to-server validation

### run.human
- `AUTH_INTERNAL_SECRET` - Must match run.auth's value
- Standard NextAuth environment variables

## Security Considerations

1. **Internal secret rotation**: Both services must be updated simultaneously
2. **Token validation is synchronous**: Adds latency to page loads when checking auth
3. **No token refresh**: If sess_auth expires mid-session, user must re-authenticate
4. **Cookie exposure**: sess_auth readable by any .defcon.run subdomain
