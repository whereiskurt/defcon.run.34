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
Service claim validation is implemented via a Strapi extension at `src/extensions/strapi-plugin-sso/strapi-server.ts` that overrides the OIDC callback handler to check for the "cms" service in the user's services claim.
