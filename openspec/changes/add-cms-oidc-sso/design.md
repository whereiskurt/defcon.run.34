# Design: CMS OIDC SSO Authentication

## Context
Strapi 5 supports SSO via Passport.js strategies configured in `config/admin.ts`. The auth.defcon.run service already has the CMS registered as an OIDC client with credentials stored in SSM. Users have a `services` claim in their OIDC tokens that lists authorized services.

## Goals
- Single sign-on for CMS admin via auth.defcon.run
- Automatic admin user creation from OIDC claims
- Access control based on `services` claim containing "cms"
- Support multi-region deployment with regional callback URLs

## Non-Goals
- Replacing local admin auth (SSO is additive)
- Fine-grained role mapping from OIDC claims (all SSO users get admin access)
- OIDC logout integration (Strapi session logout only)

## Decisions

### Decision: Use Strapi's built-in SSO provider system
Strapi 5 has native support for SSO via `auth.providers` in admin config. This is cleaner than using a community plugin since we control the OIDC provider and need custom claim validation.

**Alternatives considered:**
- `strapi-plugin-sso` community plugin - More config overhead, no built-in claim validation
- Custom middleware - Would bypass Strapi's admin auth system

### Decision: Use passport-openidconnect strategy
Standard Passport.js strategy that supports OIDC discovery and userinfo endpoints.

**Alternatives considered:**
- `passport-oauth2` - Lower level, requires manual endpoint configuration
- Custom fetch-based implementation - More code, less maintainable

### Decision: Validate services claim in Passport verify callback
The verify callback checks `services.includes("cms")` before allowing authentication. Users without this claim see a clear access denied error.

### Decision: Auto-create admin users from OIDC claims
New users are automatically created with email, firstname, lastname from OIDC profile. This simplifies onboarding since access is already gated by the services claim.

## Authentication Flow

```
1. User visits https://cms.defcon.run/use1/admin
2. Strapi shows "Login with DEFCON.run" SSO button
3. User clicks → redirect to auth.defcon.run/use1/api/oidc/auth
   - scope: openid profile email services
   - redirect_uri: https://cms.defcon.run/use1/admin/connect/oidc/callback
4. User authenticates via Discord/GitHub/Strava
5. Auth provider returns authorization code
6. Strapi exchanges code for tokens at /token endpoint
7. Strapi fetches userinfo from /me endpoint
8. Passport verify callback:
   a. Extract services claim from profile
   b. If "cms" not in services → reject with error
   c. If "cms" present → return {email, firstname, lastname}
9. Strapi creates/finds admin user, sets session cookie
10. User redirected to admin dashboard
```

## Regional Callback URL Handling

The STRAPI_URL environment variable includes the regional prefix (e.g., `https://cms.defcon.run/use1`). Strapi's `getStrategyCallbackURL('oidc')` uses this to generate the full callback URL:
- us-east-1: `https://cms.defcon.run/use1/admin/connect/oidc/callback`
- ca-central-1: `https://cms.defcon.run/cac1/admin/connect/oidc/callback`

The auth.defcon.run OIDC client registration must include both regional callback URLs.

## Risks / Trade-offs

**Risk**: OIDC provider unavailable → users cannot log in
- Mitigation: Local admin account remains functional for emergency access

**Risk**: Services claim missing from token → access denied
- Mitigation: Clear error message directing user to contact admin for access

**Trade-off**: All SSO users get full admin access
- Acceptable for now; fine-grained roles can be added later if needed

## Environment Variables

Already configured in `service.hcl`:
- `STRAPI_OIDC_CLIENT_ID` - from SSM `/dc34/secrets/{region}/strapi/oidc_client_id`
- `STRAPI_OIDC_CLIENT_SECRET` - from SSM `/dc34/secrets/{region}/strapi/oidc_client_secret`
- `STRAPI_URL` - includes regional prefix
- `REGION_SHORT` - for constructing OIDC issuer URL

## Open Questions
None - design is straightforward using Strapi's existing SSO capabilities.
