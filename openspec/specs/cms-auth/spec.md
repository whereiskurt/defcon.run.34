# cms-auth Specification

## Purpose
TBD - created by archiving change add-cms-oidc-sso. Update Purpose after archive.
## Requirements
### Requirement: OIDC SSO Authentication
The CMS admin panel SHALL support single sign-on authentication via the auth.defcon.run OIDC provider.

#### Scenario: SSO login button displayed
- **WHEN** a user visits the CMS admin login page
- **THEN** a "Login with DEFCON.run" SSO button is displayed alongside local login form

#### Scenario: SSO authentication flow initiated
- **WHEN** a user clicks the SSO login button
- **THEN** the user is redirected to auth.defcon.run for authentication
- **AND** the redirect includes scopes: openid, profile, email, services

#### Scenario: Successful SSO authentication with CMS service
- **WHEN** a user completes OIDC authentication
- **AND** the user's services claim includes "cms"
- **THEN** the user is logged into the CMS admin panel
- **AND** a session cookie is set

#### Scenario: SSO authentication rejected without CMS service
- **WHEN** a user completes OIDC authentication
- **AND** the user's services claim does NOT include "cms"
- **THEN** the user is redirected to the login page with an access denied error
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

### Requirement: Regional Callback URL Support
The CMS OIDC authentication SHALL support multi-region deployments with region-prefixed callback URLs.

#### Scenario: Regional callback URL generation
- **WHEN** the CMS generates an OIDC callback URL
- **THEN** the URL includes the regional prefix from STRAPI_URL
- **AND** the URL follows the pattern: `https://cms.defcon.run/{region}/admin/connect/oidc/callback`

#### Scenario: OIDC client accepts regional callbacks
- **WHEN** auth.defcon.run receives an OIDC callback
- **AND** the callback URL includes a regional prefix (use1 or cac1)
- **THEN** the callback is accepted as a valid redirect_uri

### Requirement: Local Admin Fallback
The CMS SHALL maintain local email/password authentication as a fallback when SSO is unavailable.

#### Scenario: Local login remains functional
- **WHEN** a user has a local Strapi admin account
- **THEN** the user can log in using email and password
- **AND** local login does not require OIDC provider availability

