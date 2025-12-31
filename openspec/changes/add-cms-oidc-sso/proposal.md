# Change: Add OIDC SSO Authentication to CMS Admin Panel

## Why

The Strapi CMS admin panel currently uses local email/password authentication. To integrate with the existing defcon.run identity system and enforce service-based access control, the CMS should authenticate admin users via OIDC SSO through auth.defcon.run. Users with `services: ["cms"]` in their profile should automatically get admin access.

## What Changes

- **NEW** strapi-plugin-sso community plugin for OIDC authentication (free alternative to Enterprise SSO)
- **NEW** Plugin extension for custom services claim validation
- **MODIFIED** Auth service OIDC client registration to support plugin callback URLs
- **MODIFIED** CMS infrastructure to add ALB routing for plugin endpoints
- **REMOVED** Unused Enterprise SSO configuration from config/admin.ts

## Implementation Approach

Strapi's built-in SSO via `auth.providers` requires an Enterprise license. We use the free [strapi-plugin-sso](https://github.com/yasudacloud/strapi-plugin-sso) community plugin instead, with a custom extension for services claim validation.

**Key differences from original plan:**
- Uses community plugin instead of Enterprise `auth.providers`
- No SSO button on login page - users navigate directly to SSO URL
- Extension pattern to inject custom claim validation

## Impact

- **Affected specs**: None (new capability)
- **Affected code**:
  - `apps/run.cms/app/config/admin.ts` - Remove unused Enterprise SSO config
  - `apps/run.cms/app/config/plugins.ts` - Add strapi-plugin-sso configuration
  - `apps/run.cms/app/package.json` - Replace passport-openidconnect with strapi-plugin-sso
  - `apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts` - New: Services claim validation
  - `apps/run.auth/webapp/src/config/oidc.ts` - Update callback URLs
  - `infra/terraform/live/site/services/cms/service.hcl` - Add env vars and ALB route
- **Dependencies**: Requires `add-strapi-cms` change to be deployed first
- **Infrastructure changes**: New ALB listener rule for `/{{REGION_LABEL}}/strapi-plugin-sso/*`
