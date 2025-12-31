# Change: Add OIDC SSO Authentication to CMS Admin Panel

## Why
The Strapi CMS admin panel currently uses local email/password authentication. To integrate with the existing defcon.run identity system and enforce service-based access control, the CMS should authenticate admin users via OIDC SSO through auth.defcon.run. Users with `services: ["cms"]` in their profile should automatically get admin access.

## What Changes
- **NEW** OIDC SSO provider configuration in Strapi admin panel
- **NEW** Passport.js OpenID Connect strategy for authentication
- **MODIFIED** Auth service OIDC client registration to support CMS regional callbacks
- **NEW** Service claim validation - only users with "cms" in services array can access admin

## Impact
- **Affected specs**: None (new capability)
- **Affected code**:
  - `apps/run.cms/app/config/admin.ts` - SSO provider configuration
  - `apps/run.cms/app/config/middlewares.ts` - CSP directives for auth.defcon.run
  - `apps/run.cms/app/package.json` - Add passport-openidconnect dependency
  - `apps/run.auth/webapp/src/config/oidc.ts` - Add regional callback URLs
- **Dependencies**: Requires `add-strapi-cms` change to be deployed first
- **No infrastructure changes** - uses existing SSM secrets for OIDC credentials
