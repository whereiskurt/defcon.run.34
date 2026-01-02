# Design: CMS OIDC SSO Authentication

## Context

Strapi 5's built-in SSO via `auth.providers` in `config/admin.ts` **requires an Enterprise license or SSO add-on**. Since DEF CON uses the Community Edition, we must use the free [strapi-plugin-sso](https://github.com/yasudacloud/strapi-plugin-sso) community plugin instead.

The auth.defcon.run service already has the CMS registered as an OIDC client with credentials stored in SSM. Users have a `services` claim in their OIDC tokens that lists authorized services.

## Goals

- Single sign-on for CMS admin via auth.defcon.run
- Automatic admin user creation from OIDC claims
- Access control based on `services` claim containing "cms"
- Support multi-region deployment with regional callback URLs

## Non-Goals

- Replacing local admin auth (SSO is additive)
- Fine-grained role mapping from OIDC claims (all SSO users get admin access)
- OIDC logout integration (Strapi session logout only)
- Injecting SSO button into Strapi login page (plugin uses direct URL access)

## Decisions

### Decision: Use strapi-plugin-sso community plugin

Strapi 5's built-in SSO (`auth.providers` in admin config) requires an Enterprise license. The community plugin provides equivalent functionality for free.

**Why not Enterprise SSO:**
- Requires paid Enterprise license or SSO add-on
- Current implementation in `config/admin.ts` would be silently ignored on Community Edition

**Why strapi-plugin-sso:**
- Free, MIT-licensed, actively maintained
- Supports Strapi 5 (version 1.0.7+)
- Provides OIDC authentication flow
- Can be extended via Strapi's plugin extension system

### Decision: Extend plugin controller for services claim validation

The plugin doesn't natively support custom claim validation. We'll use Strapi's extension system to override the `oidcSignInCallback` controller and inject services claim checking.

**Implementation:**
- Create `src/extensions/strapi-plugin-sso/strapi-server.ts`
- Override `plugin.controllers.oidc.oidcSignInCallback`
- Check `userData.services.includes('cms')` before allowing login
- Return clear error message if user lacks CMS access

### Decision: Direct URL access for SSO login

Unlike Enterprise SSO which shows buttons on the login page, strapi-plugin-sso requires users to navigate directly to the SSO initiation URL. This is acceptable UX for CMS admins.

**SSO URLs:**
- Production: `https://cms.defcon.run/{region}/strapi-plugin-sso/oidc`
- Local dev: `http://localhost:1337/strapi-plugin-sso/oidc`

**Standard login remains available:**
- Production: `https://cms.defcon.run/{region}/admin`
- Used for local admin fallback when SSO is unavailable

### Decision: Auto-create admin users from OIDC claims

New users are automatically created with email and name from OIDC profile. This simplifies onboarding since access is already gated by the services claim.

## Authentication Flow

```
1. User navigates to https://cms.defcon.run/use1/strapi-plugin-sso/oidc
2. Plugin redirects to auth.defcon.run/use1/api/oidc/auth
   - scope: openid profile email services
   - redirect_uri: https://cms.defcon.run/use1/strapi-plugin-sso/oidc/callback
3. User authenticates via Discord/GitHub/Strava at auth.defcon.run
4. Auth provider returns authorization code to callback
5. Plugin exchanges code for tokens at /token endpoint
6. Plugin fetches userinfo from /me endpoint
7. Our extension validates services claim:
   a. Extract services array from userinfo
   b. If "cms" not in services -> render access denied error
   c. If "cms" present -> continue with user creation/login
8. Plugin creates/finds admin user, generates JWT
9. Plugin renders HTML that stores JWT in browser storage
10. User redirected to admin dashboard
```

## Regional URL Handling

The plugin callback URLs include regional prefixes to support multi-region deployment:

**Callback URLs registered in auth.defcon.run:**
- `https://cms.defcon.run/use1/strapi-plugin-sso/oidc/callback`
- `https://cms.defcon.run/cac1/strapi-plugin-sso/oidc/callback`
- `http://localhost:1337/strapi-plugin-sso/oidc/callback` (dev)

**ALB routing required:**
- Current: `/{{REGION_LABEL}}/admin*` routes to CMS master
- New: `/{{REGION_LABEL}}/strapi-plugin-sso/*` also routes to CMS master

## Risks / Trade-offs

**Risk**: Plugin updates could break our extension
- Mitigation: Pin plugin version, test updates in staging before production

**Risk**: OIDC provider unavailable -> users cannot log in via SSO
- Mitigation: Local admin account remains functional for emergency access

**Risk**: Services claim missing from token -> access denied
- Mitigation: Clear error message directing user to contact admin for CMS access

**Trade-off**: No SSO button on login page
- Users must bookmark or know the SSO URL
- Acceptable for small team of CMS admins

**Trade-off**: All SSO users get full admin access
- Acceptable for now; fine-grained roles can be added later if needed

## Environment Variables

**Existing (already in service.hcl):**
- `STRAPI_OIDC_CLIENT_ID` - from SSM `/dc34/secrets/{region}/strapi/oidc_client_id`
- `STRAPI_OIDC_CLIENT_SECRET` - from SSM `/dc34/secrets/{region}/strapi/oidc_client_secret`
- `REGION_SHORT` - for constructing OIDC issuer URL

**New (to be added):**
- `STRAPI_OIDC_REDIRECT_URI` - callback URL with regional prefix
- `STRAPI_OIDC_AUTH_ENDPOINT` - auth.defcon.run authorization endpoint
- `STRAPI_OIDC_TOKEN_ENDPOINT` - auth.defcon.run token endpoint
- `STRAPI_OIDC_USERINFO_ENDPOINT` - auth.defcon.run userinfo endpoint

## Files to Modify

| File | Change |
|------|--------|
| `apps/run.cms/app/config/admin.ts` | Remove auth.providers (Enterprise SSO), keep other config |
| `apps/run.cms/app/package.json` | Remove passport-openidconnect, add strapi-plugin-sso |
| `apps/run.cms/app/config/plugins.ts` | Add strapi-plugin-sso configuration |
| `apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts` | New: Controller extension for services claim validation |
| `apps/run.auth/webapp/src/config/oidc.ts` | Update callback URLs to plugin pattern |
| `infra/terraform/live/site/services/cms/service.hcl` | Add OIDC endpoint env vars + ALB route |

## Open Questions

None - design is complete and approved.
