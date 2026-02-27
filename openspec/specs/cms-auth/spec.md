# cms-auth Specification

## Purpose
OIDC SSO authentication for the Strapi CMS admin panel via auth.defcon.run, with service claim validation to restrict access to authorized users.

## Requirements

### Requirement: OIDC SSO Authentication
The CMS admin panel SHALL support single sign-on authentication via the auth.defcon.run OIDC provider using the strapi-plugin-sso community plugin.

#### Scenario: SSO login flow
- **WHEN** a user navigates to the SSO URL (`/{region}/strapi-plugin-sso/oidc`)
- **THEN** the user is redirected to auth.defcon.run for authentication
- **AND** the redirect includes scopes: openid, profile, email, services

#### Scenario: Successful SSO authentication with CMS service
- **WHEN** a user completes OIDC authentication
- **AND** the user's services claim includes "cms"
- **THEN** the user is logged into the CMS admin panel

#### Scenario: SSO authentication rejected without CMS service
- **WHEN** a user completes OIDC authentication
- **AND** the user's services claim does NOT include "cms"
- **THEN** the user sees an access denied error

### Requirement: SSO User Auto-Registration
The CMS SHALL automatically create admin user accounts for first-time SSO users who have the "cms" service claim.

#### Scenario: New SSO user registration
- **WHEN** a user authenticates via SSO for the first time with "cms" service
- **THEN** a new Strapi admin user is created with email and name from OIDC claims

#### Scenario: Returning SSO user login
- **WHEN** a user authenticates via SSO and a matching admin user exists
- **THEN** the existing user is logged in without creating a duplicate

### Requirement: Regional URL Support
The CMS OIDC authentication SHALL support multi-region deployments with region-prefixed URLs (use1, cac1).

#### Scenario: Regional SSO URL access
- **GIVEN** the CMS is deployed with a regional prefix
- **WHEN** a user accesses `/{region}/strapi-plugin-sso/oidc`
- **THEN** nginx strips the regional prefix before proxying to Strapi

#### Scenario: Regional callback URL
- **WHEN** the CMS generates an OIDC callback URL
- **THEN** it follows the pattern `https://cms.defcon.run/{region}/strapi-plugin-sso/oidc/callback`

### Requirement: Hybrid Token Storage
The CMS SHALL use a hybrid token storage model: httpOnly cookie for refresh token, localStorage for access token (required by Strapi SPA architecture).

#### Scenario: Token storage on login
- **WHEN** a user successfully authenticates via SSO
- **THEN** the refresh token is stored in a `strapi_admin_refresh` httpOnly cookie
- **AND** the access token is stored in `localStorage.jwtToken` and `localStorage.STRAPI_ADMIN_AUTH_TOKEN`

#### Scenario: Short token lifespans
- **GIVEN** access token lifespan is 5 minutes and refresh token lifespan is 10 minutes
- **WHEN** the access token expires
- **THEN** Strapi refreshes using the httpOnly cookie refresh token

### Requirement: Services Claim Validation
The CMS SHALL periodically validate that users still have the "cms" service claim via middleware.

#### Scenario: Background services validation
- **GIVEN** 5 minutes have passed since the last validation
- **WHEN** the middleware intercepts a request
- **THEN** it calls auth.defcon.run via private service discovery to validate services

#### Scenario: Services claim revoked
- **WHEN** validation finds the user no longer has "cms" service
- **THEN** the user receives a 401 response

#### Scenario: Validation failure graceful handling
- **WHEN** the auth server is unavailable
- **THEN** the session continues (fail-open for availability)

### Requirement: SSO Session Expiry Redirect
The CMS SHALL automatically redirect to SSO when sessions expire.

#### Scenario: Session timeout redirects to SSO
- **WHEN** an API call returns 401
- **THEN** the user is redirected to `/{region}/strapi-plugin-sso/oidc`

#### Scenario: Login page auto-redirects to SSO
- **WHEN** a user navigates to `/{region}/admin/auth/login`
- **THEN** the page automatically redirects to the SSO URL

### Requirement: OIDC Logout Integration
The CMS logout SHALL invalidate the session at auth.defcon.run.

#### Scenario: Logout triggers OIDC end_session
- **WHEN** a user clicks logout in Strapi admin
- **THEN** the user is redirected to auth.defcon.run's end_session endpoint
- **AND** httpOnly cookies are invalidated

### Requirement: Local Admin Fallback
The CMS SHALL maintain local email/password authentication as a fallback when SSO is unavailable.

#### Scenario: Local login remains functional
- **WHEN** a user has a local Strapi admin account
- **THEN** the user can log in using email and password without OIDC availability

## Implementation Notes

- Plugin extension: `src/extensions/strapi-plugin-sso/strapi-server.ts`
- Middleware: `src/middlewares/services-validation.ts`, `src/middlewares/cookie-auth.ts`
- Admin customization: `src/admin/app.tsx` (auto-redirect, fetch interceptors)
- Session config in `config/admin.ts`: access=5min, refresh=10min, idle=10min
- Nginx handles `/{region}/` prefix stripping and login page redirects
