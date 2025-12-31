# Tasks: Add CMS OIDC SSO Authentication

> **Note**: This implementation uses the free `strapi-plugin-sso` community plugin instead of Strapi's built-in Enterprise SSO, which requires a paid license.

## 1. Remove Enterprise SSO Code

- [ ] 1.1 Update `apps/run.cms/app/config/admin.ts`:
  - Remove `import { Strategy as OIDCStrategy } from 'passport-openidconnect'`
  - Remove entire `auth.providers` array from the config
  - Keep `url`, `apiToken`, `transfer`, and `flags` configuration

- [ ] 1.2 Update `apps/run.cms/app/package.json`:
  - Remove `passport-openidconnect` from dependencies

## 2. Install and Configure Community Plugin

- [ ] 2.1 Install strapi-plugin-sso:
  ```bash
  cd apps/run.cms/app
  npm install strapi-plugin-sso@^1.0.7
  ```

- [ ] 2.2 Update `apps/run.cms/app/config/plugins.ts` to add plugin config:
  ```typescript
  'strapi-plugin-sso': {
    enabled: true,
    config: {
      OIDC_CLIENT_ID: env('STRAPI_OIDC_CLIENT_ID'),
      OIDC_CLIENT_SECRET: env('STRAPI_OIDC_CLIENT_SECRET'),
      OIDC_REDIRECT_URI: env('STRAPI_OIDC_REDIRECT_URI'),
      OIDC_SCOPES: 'openid profile email services',
      OIDC_AUTHORIZATION_ENDPOINT: env('STRAPI_OIDC_AUTH_ENDPOINT'),
      OIDC_TOKEN_ENDPOINT: env('STRAPI_OIDC_TOKEN_ENDPOINT'),
      OIDC_USER_INFO_ENDPOINT: env('STRAPI_OIDC_USERINFO_ENDPOINT'),
      OIDC_USER_INFO_ENDPOINT_WITH_AUTH_HEADER: true,
      OIDC_GRANT_TYPE: 'authorization_code',
      OIDC_FAMILY_NAME_FIELD: 'name',
      OIDC_GIVEN_NAME_FIELD: 'name',
      OIDC_REQUIRED_SERVICES: 'cms',
      USE_WHITELIST: false,
    },
  },
  ```

## 3. Create Plugin Extension for Services Claim Validation

- [ ] 3.1 Create directory `apps/run.cms/app/src/extensions/strapi-plugin-sso/`

- [ ] 3.2 Create `apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts`:
  - Import axios, randomUUID from node:crypto
  - Export default function that receives plugin object
  - Override `plugin.controllers.oidc.oidcSignInCallback`
  - Implement services claim validation:
    - Extract `services` array from userinfo response
    - Check if `OIDC_REQUIRED_SERVICES` (cms) is in array
    - Return access denied error if not present
    - Continue with normal flow if present
  - Handle name splitting from `name` claim to firstname/lastname
  - Return modified plugin object

## 4. Update Auth Service OIDC Client

- [ ] 4.1 Update `apps/run.auth/webapp/src/config/oidc.ts`:
  - Replace CMS client `redirect_uris` with plugin callback URLs:
    - `https://cms.defcon.run/use1/strapi-plugin-sso/oidc/callback`
    - `https://cms.defcon.run/cac1/strapi-plugin-sso/oidc/callback`
    - `http://localhost:1337/strapi-plugin-sso/oidc/callback`
  - Remove old `/admin/connect/oidc/callback` URLs

- [ ] 4.2 Rebuild and deploy auth service

## 5. Update Infrastructure

- [ ] 5.1 Update `infra/terraform/live/site/services/cms/service.hcl`:
  - Add environment variables to cms-master container:
    ```hcl
    { name = "STRAPI_OIDC_REDIRECT_URI", value = "https://cms.defcon.run/{{REGION_LABEL}}/strapi-plugin-sso/oidc/callback" },
    { name = "STRAPI_OIDC_AUTH_ENDPOINT", value = "https://auth.defcon.run/{{REGION_LABEL}}/api/oidc/auth" },
    { name = "STRAPI_OIDC_TOKEN_ENDPOINT", value = "https://auth.defcon.run/{{REGION_LABEL}}/api/oidc/token" },
    { name = "STRAPI_OIDC_USERINFO_ENDPOINT", value = "https://auth.defcon.run/{{REGION_LABEL}}/api/oidc/me" },
    ```
  - Add ALB listener rule for SSO plugin route:
    ```hcl
    {
      type = "alb"
      container_name = "cms-nginx"
      container_port = 443
      # ... health check config ...
      listener = {
        port = 443
        protocol = "HTTPS"
        host_headers = ["cms.defcon.run"]
        path_pattern = "/{{REGION_LABEL}}/strapi-plugin-sso/*"
        priority = 99
      }
    }
    ```

## 6. Build and Deploy

- [ ] 6.1 Rebuild CMS app Docker image with new plugin and extension
- [ ] 6.2 Deploy infrastructure changes (ALB route)
- [ ] 6.3 Deploy CMS to us-east-1

## 7. Validation

- [ ] 7.1 Navigate to `https://cms.defcon.run/use1/strapi-plugin-sso/oidc`
- [ ] 7.2 Verify redirect to auth.defcon.run for authentication
- [ ] 7.3 Test login with user who has "cms" in services claim - should succeed
- [ ] 7.4 Test login with user without "cms" in services claim - should see access denied error
- [ ] 7.5 Verify new SSO user is auto-created with correct name and email
- [ ] 7.6 Verify existing SSO user is recognized on subsequent logins
- [ ] 7.7 Verify local admin login still works at `/use1/admin` (fallback access)

## Implementation Notes

### Plugin Extension Pattern

The extension file at `src/extensions/strapi-plugin-sso/strapi-server.ts` follows Strapi's plugin extension pattern:

```typescript
export default (plugin) => {
  // Override specific controller method
  plugin.controllers.oidc.oidcSignInCallback = async (ctx) => {
    // Custom implementation with services claim validation
  };
  return plugin;
};
```

### Services Claim Validation Logic

```typescript
const requiredServices = (config['OIDC_REQUIRED_SERVICES'] || '').split(',').map(s => s.trim());
const userServices: string[] = userData.services || [];

if (requiredServices.length > 0) {
  const hasAccess = requiredServices.some(svc => userServices.includes(svc));
  if (!hasAccess) {
    return ctx.send(oauthService.renderSignUpError(
      'Access denied: Your account does not have CMS access. ' +
      'Required service: cms. Please contact an administrator.'
    ));
  }
}
```

### SSO Login URL

Users access CMS SSO via direct URL (no button on login page):
- **Production**: `https://cms.defcon.run/use1/strapi-plugin-sso/oidc`
- **Local dev**: `http://localhost:1337/strapi-plugin-sso/oidc`
