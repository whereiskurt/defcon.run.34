## ADDED Requirements

### Requirement: Region Prefix Trailing Slash Redirect

The static asset hosting SHALL redirect requests to region prefixes without trailing slashes to the equivalent path with a trailing slash.

#### Scenario: Redirect /use1 to /use1/
- **GIVEN** a user or system navigates to `https://run.defcon.run/use1` (no trailing slash)
- **WHEN** CloudFront routes the request to S3
- **THEN** S3 serves a redirect HTML file
- **AND** the user is redirected to `https://run.defcon.run/use1/`
- **AND** the request with trailing slash routes to the ALB

#### Scenario: Redirect /cac1 to /cac1/
- **GIVEN** a user or system navigates to `https://run.defcon.run/cac1` (no trailing slash)
- **WHEN** CloudFront routes the request to S3
- **THEN** S3 serves a redirect HTML file
- **AND** the user is redirected to `https://run.defcon.run/cac1/`
- **AND** the request with trailing slash routes to the ALB

#### Scenario: Post-logout redirect works correctly
- **GIVEN** a user logs out from the CMS or other OIDC client
- **AND** the post_logout_redirect_uri is `https://run.defcon.run/use1`
- **WHEN** the auth server redirects to the post-logout URI
- **THEN** the user is redirected to `https://run.defcon.run/use1/`
- **AND** the ALB serves the run.human application

#### Scenario: Redirect /use1 to /use1/ on auth.defcon.run
- **GIVEN** a user or system navigates to `https://auth.defcon.run/use1` (no trailing slash)
- **WHEN** CloudFront routes the request to S3
- **THEN** S3 serves a redirect HTML file
- **AND** the user is redirected to `https://auth.defcon.run/use1/`
- **AND** the request with trailing slash routes to the ALB

#### Scenario: Redirect /cac1 to /cac1/ on auth.defcon.run
- **GIVEN** a user or system navigates to `https://auth.defcon.run/cac1` (no trailing slash)
- **WHEN** CloudFront routes the request to S3
- **THEN** S3 serves a redirect HTML file
- **AND** the user is redirected to `https://auth.defcon.run/cac1/`
- **AND** the request with trailing slash routes to the ALB
