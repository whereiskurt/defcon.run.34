# cms-auth Specification

## Purpose
Defines OIDC SSO authentication for the Strapi CMS admin panel via auth.defcon.run, with service claim validation to restrict access to authorized users.

## Requirements
### Requirement: OIDC SSO Authentication
The CMS admin panel SHALL support single sign-on authentication via the auth.defcon.run OIDC provider using the strapi-plugin-sso community plugin.

#### Scenario: SSO login via direct URL
- **WHEN** a user navigates to the SSO URL (`/{region}/strapi-plugin-sso/oidc`)
- **THEN** the user is redirected to auth.defcon.run for authentication
- **AND** the redirect includes scopes: openid, profile, email, services

#### Scenario: SSO authentication flow initiated
- **WHEN** a user clicks the SSO login link
- **THEN** the user is redirected to auth.defcon.run for authentication
- **AND** the redirect includes scopes: openid, profile, email, services

#### Scenario: Successful SSO authentication with CMS service
- **WHEN** a user completes OIDC authentication
- **AND** the user's services claim includes "cms"
- **THEN** the user is logged into the CMS admin panel
- **AND** a session is established

#### Scenario: SSO authentication rejected without CMS service
- **WHEN** a user completes OIDC authentication
- **AND** the user's services claim does NOT include "cms"
- **THEN** the user sees an access denied error
- **AND** the error message indicates the user needs CMS service authorization

### Requirement: SSO User Auto-Registration
The CMS SHALL automatically create admin user accounts for users who authenticate via SSO and have the "cms" service claim.

#### Scenario: New SSO user registration
- **WHEN** a user authenticates via SSO for the first time
- **AND** the user has "cms" in their services claim
- **THEN** a new Strapi admin user is created
- **AND** the user's email is set from the OIDC email claim
- **AND** the user's name is set from the OIDC name/profile claims

#### Scenario: Returning SSO user login
- **WHEN** a user authenticates via SSO
- **AND** a Strapi admin user already exists with that email
- **THEN** the existing user is logged in
- **AND** no duplicate user is created

### Requirement: Regional URL Support
The CMS OIDC authentication SHALL support multi-region deployments with region-prefixed URLs.

#### Scenario: Regional SSO URL access
- **GIVEN** the CMS is deployed with a regional prefix (e.g., use1, cac1)
- **WHEN** a user accesses the SSO URL at `/{region}/strapi-plugin-sso/oidc`
- **THEN** nginx strips the regional prefix before proxying to Strapi
- **AND** Strapi handles the request at `/strapi-plugin-sso/oidc`

#### Scenario: Regional callback URL generation
- **WHEN** the CMS generates an OIDC callback URL
- **THEN** the URL includes the regional prefix
- **AND** the URL follows the pattern: `https://cms.defcon.run/{region}/strapi-plugin-sso/oidc/callback`

#### Scenario: Development environment without prefix
- **GIVEN** the CMS is running in development mode
- **WHEN** a user accesses the SSO URL at `/strapi-plugin-sso/oidc`
- **THEN** no regional prefix is required
- **AND** the callback URL is `http://localhost:1337/strapi-plugin-sso/oidc/callback`

#### Scenario: OIDC client accepts regional callbacks
- **WHEN** auth.defcon.run receives an OIDC callback
- **AND** the callback URL includes a regional prefix (use1 or cac1)
- **THEN** the callback is accepted as a valid redirect_uri

### Requirement: Secure Token Storage (Hybrid Model)
The CMS SHALL use a hybrid token storage model that balances security with Strapi SPA requirements.

**Constraint**: Strapi v5's admin panel is a Single Page Application (SPA) that checks `localStorage` for authentication tokens before making API calls. Pure httpOnly cookie storage is not possible without forking Strapi's admin panel.

#### Scenario: Refresh token stored in httpOnly cookie
- **WHEN** a user successfully authenticates via SSO
- **THEN** the refresh token is stored in a `strapi_admin_refresh` httpOnly cookie
- **AND** the cookie has `sameSite: lax`
- **AND** the refresh token is protected from XSS attacks

#### Scenario: Access token stored in localStorage (SPA requirement)
- **WHEN** a user successfully authenticates via SSO
- **THEN** the access token is stored in `localStorage.jwtToken`
- **AND** the access token is stored in `localStorage.STRAPI_ADMIN_AUTH_TOKEN`
- **AND** the access token is short-lived (5 minutes) to limit XSS exposure window
- **NOTE** This is required because Strapi's admin SPA checks localStorage before making API calls

#### Scenario: Token cleanup on logout and session expiry
- **WHEN** a user logs out or receives a 401 response
- **THEN** localStorage tokens are cleared (`jwtToken`, `STRAPI_ADMIN_AUTH_TOKEN`)
- **AND** the user is redirected appropriately (OIDC end_session or SSO login)

### Requirement: Short Session Lifespan
The CMS SHALL use short session lifespans to enable frequent re-validation of user permissions.

#### Scenario: Access token expires quickly
- **GIVEN** the access token lifespan is configured to 5 minutes
- **WHEN** the access token expires
- **THEN** Strapi attempts to refresh using the refresh token

#### Scenario: Refresh token expires for re-authentication
- **GIVEN** the refresh token lifespan is configured to 10 minutes
- **WHEN** the refresh token expires
- **THEN** the user must re-authenticate via SSO
- **AND** the services claim is re-validated during authentication

### Requirement: Services Claim Validation
The CMS SHALL periodically validate that users still have the "cms" service claim.

#### Scenario: Background services validation
- **GIVEN** a user is authenticated in the CMS
- **WHEN** 5 minutes have passed since the last validation
- **THEN** the middleware calls auth.defcon.run to validate the user's services
- **AND** uses private service discovery (`auth.app-{region}-defcon-run.local`)

#### Scenario: User services claim revoked
- **GIVEN** a user is authenticated in the CMS
- **WHEN** the services validation finds the user no longer has "cms" service
- **THEN** the user receives a 401 response
- **AND** the user is redirected to SSO for re-authentication

#### Scenario: Validation failure graceful handling
- **GIVEN** a user is authenticated in the CMS
- **WHEN** the services validation call fails (auth server unavailable)
- **THEN** the session continues (fail-open for availability)
- **AND** the failure is logged

### Requirement: SSO Session Expiry Redirect
The CMS SHALL automatically redirect users to SSO when their session expires.

#### Scenario: Session timeout redirects to SSO
- **WHEN** a user's session expires
- **AND** an API call returns 401
- **THEN** the user is redirected to `/{region}/strapi-plugin-sso/oidc`
- **AND** the user is NOT shown the internal Strapi login page

#### Scenario: Login page auto-redirects to SSO
- **WHEN** a user navigates to `/{region}/admin/auth/login`
- **THEN** the page automatically redirects to the SSO URL
- **AND** provides seamless re-authentication experience

### Requirement: OIDC Logout Integration
The CMS logout SHALL invalidate the session at auth.defcon.run.

#### Scenario: Logout triggers OIDC end_session
- **WHEN** a user clicks the logout button in Strapi admin
- **THEN** the user is redirected to auth.defcon.run's end_session endpoint
- **AND** the `post_logout_redirect_uri` is set to `/{region}/admin`
- **AND** httpOnly cookies are invalidated server-side

#### Scenario: Post-logout redirect returns to CMS
- **WHEN** auth.defcon.run completes the logout
- **THEN** the user is redirected back to the CMS admin
- **AND** the user can initiate a new SSO login

### Requirement: Local Admin Fallback
The CMS SHALL maintain local email/password authentication as a fallback when SSO is unavailable.

#### Scenario: Local login remains functional
- **WHEN** a user has a local Strapi admin account
- **THEN** the user can log in using email and password at `/{region}/admin`
- **AND** local login does not require OIDC provider availability

## Implementation Notes

### SSO URLs
- **Production**: `https://cms.defcon.run/use1/strapi-plugin-sso/oidc`
- **Development**: `http://localhost:1337/strapi-plugin-sso/oidc`

### Architecture
The strapi-plugin-sso community plugin registers routes at `/strapi-plugin-sso/*` without awareness of regional prefixes. Nginx handles the prefix stripping:
- Request: `/use1/strapi-plugin-sso/oidc`
- Nginx rewrites to: `/strapi-plugin-sso/oidc`
- Strapi handles: `/strapi-plugin-sso/oidc`

### Plugin Extension
Service claim validation is implemented via a Strapi extension at `src/extensions/strapi-plugin-sso/strapi-server.ts` that:
- Overrides the OIDC callback handler to check for "cms" service in user's services claim
- Uses Strapi's `sessionManager` API to generate tokens
- Stores refresh token in httpOnly cookie (XSS protected)
- Returns HTML that sets access token in localStorage (required by Strapi SPA)
- Redirects to admin panel after successful auth

### Middleware Stack
Custom middleware handles services validation:

**services-validation** (`src/middlewares/services-validation.ts`)
- Validates user's services claim every 5 minutes
- Calls auth server via private service discovery
- Returns 401 if user no longer has "cms" service

### Admin Panel Customization
The admin panel (`src/admin/app.tsx`) provides:
- Auto-redirect from `/admin/auth/login` to SSO URL
- Fetch interceptor for 401 responses → clears localStorage → SSO redirect
- Fetch interceptor for logout → clears localStorage → calls Strapi logout → OIDC end_session redirect

### Security Model
| Token | Storage | Protection | Lifespan |
|-------|---------|------------|----------|
| Refresh token | httpOnly cookie | XSS protected | 10 min |
| Access token | localStorage | Short-lived (mitigates XSS) | 5 min |

**Trade-off**: Access token in localStorage is required by Strapi's SPA architecture. The 5-minute lifespan limits the exposure window if an XSS attack occurs. The refresh token remains protected in an httpOnly cookie, preventing attackers from extending sessions.

### Session Configuration
Configured in `config/admin.ts`:
- Access token lifespan: 5 minutes
- Refresh token lifespan: 10 minutes
- Idle session timeout: 10 minutes

### Nginx Configuration
- Redirects `/admin/auth/login` → `/use1/admin/auth/login` (fixes Strapi hardcoded redirect)
- Strips regional prefix for SSO plugin routes
