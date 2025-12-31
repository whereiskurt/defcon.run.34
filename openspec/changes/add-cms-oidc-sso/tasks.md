# Tasks: Add CMS OIDC SSO Authentication

## 1. Dependencies

- [ ] 1.1 Add `passport-openidconnect` to `apps/run.cms/app/package.json`

## 2. Auth Service Updates

- [ ] 2.1 Add regional callback URLs to CMS OIDC client in `apps/run.auth/webapp/src/config/oidc.ts`:
  - `https://cms.defcon.run/use1/admin/connect/oidc/callback`
  - `https://cms.defcon.run/cac1/admin/connect/oidc/callback`
- [ ] 2.2 Rebuild and deploy auth service with updated OIDC client configuration

## 3. Strapi SSO Configuration

- [ ] 3.1 Update `apps/run.cms/app/config/admin.ts` to add OIDC SSO provider:
  - Configure `auth.providers` array with OIDC strategy
  - Set issuer URL based on `REGION_SHORT` env var
  - Use `passport-openidconnect` strategy with auth.defcon.run endpoints
  - Implement verify callback with services claim validation
  - Map OIDC claims to Strapi admin user fields (email, firstname, lastname)
  - Reject users without "cms" in services claim with clear error message

- [ ] 3.2 Update `apps/run.cms/app/config/middlewares.ts` to add CSP directives:
  - Add `https://auth.defcon.run` to `connect-src`
  - Add `https://auth.defcon.run` to `form-action`

## 4. Build and Deploy

- [ ] 4.1 Rebuild CMS app image with new dependencies and configuration
- [ ] 4.2 Deploy updated CMS to us-east-1

## 5. Validation

- [ ] 5.1 Verify SSO button appears on admin login page
- [ ] 5.2 Verify clicking SSO button redirects to auth.defcon.run
- [ ] 5.3 Test login with user who has "cms" in services claim - should succeed
- [ ] 5.4 Test login with user without "cms" in services claim - should see access denied error
- [ ] 5.5 Verify new SSO user is auto-created with correct name and email
- [ ] 5.6 Verify existing SSO user is recognized on subsequent logins
- [ ] 5.7 Verify local admin login still works (fallback access)
