# cms-email Specification

## Purpose
Custom AWS SES email provider for the Strapi CMS, using AWS SDK v3 directly to eliminate security vulnerabilities from third-party npm email packages.

## Requirements

### Requirement: Custom AWS SES Email Provider
The CMS SHALL use a local custom email provider (`strapi-provider-email-aws-ses-v3`) that interfaces directly with AWS SDK v3 `@aws-sdk/client-ses`.

#### Scenario: Provider uses AWS SDK v3
- **WHEN** an email is sent
- **THEN** it is delivered via AWS SDK v3 SES client
- **AND** no third-party email abstraction packages are used

#### Scenario: Provider is a local package
- **GIVEN** the provider is at `providers/strapi-provider-email-aws-ses-v3/`
- **WHEN** npm install is run
- **THEN** the provider is linked via `file:` reference in `package.json`

### Requirement: AWS Credential Chain
The CMS email provider SHALL use the AWS default credential chain for authentication.

#### Scenario: Production uses IAM role
- **GIVEN** the CMS is running on ECS Fargate
- **WHEN** an email is sent
- **THEN** credentials are obtained from the ECS task IAM role

#### Scenario: Development uses AWS profile
- **GIVEN** the CMS is running locally
- **WHEN** an email is sent
- **THEN** credentials are obtained from the AWS CLI profile

### Requirement: Email Configuration
The provider SHALL be configured via environment variables.

#### Scenario: Region and sender configuration
- **GIVEN** `AWS_REGION`, `SES_FROM_ADDRESS`, `SES_REPLYTO_ADDRESS` are set
- **WHEN** an email is sent
- **THEN** the provider uses the configured region (default: us-east-1) and sender (default: cms@defcon.run)

### Requirement: Standard Email Operations
The provider SHALL support standard Strapi email operations: HTML body, text body, and multiple recipients (To/CC/BCC).

#### Scenario: Send email with HTML and text body
- **WHEN** an email is sent with HTML and/or plain text content
- **THEN** the email is delivered via SES with the appropriate body format

## Implementation Notes

- Source: `apps/run.cms/app/providers/strapi-provider-email-aws-ses-v3/`
- Entry point: `index.js`
- Peer dependency: `@aws-sdk/client-ses` ^3.0.0
- Config in `config/plugins.ts` under `email.config`
