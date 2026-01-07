# cms-email Specification

## Purpose
Defines the email provider configuration for the Strapi CMS, using a custom AWS SES provider to eliminate known vulnerabilities from third-party npm email packages.

## Requirements

### Requirement: Custom AWS SES Email Provider
The CMS SHALL use a custom email provider (`strapi-provider-email-aws-ses-v3`) that uses AWS SDK v3 directly to eliminate security vulnerabilities from third-party npm packages.

#### Scenario: Provider uses AWS SDK v3
- **GIVEN** the CMS email provider is configured
- **WHEN** an email is sent
- **THEN** the email is sent via AWS SDK v3 `@aws-sdk/client-ses`
- **AND** no third-party email abstraction packages are used

#### Scenario: Provider package is local
- **GIVEN** the provider is located in `providers/strapi-provider-email-aws-ses-v3/`
- **WHEN** npm install is run
- **THEN** the provider is linked via `file:` reference in `package.json`
- **AND** no external npm registry is used for the provider

### Requirement: AWS Credential Chain
The CMS email provider SHALL use the AWS default credential chain for authentication.

#### Scenario: Production uses IAM role
- **GIVEN** the CMS is running on ECS Fargate
- **WHEN** an email is sent
- **THEN** credentials are obtained from the ECS task IAM role
- **AND** no static credentials are configured

#### Scenario: Development uses AWS profile
- **GIVEN** the CMS is running locally
- **WHEN** an email is sent
- **THEN** credentials are obtained from the AWS CLI profile
- **AND** no static credentials are required in environment variables

### Requirement: Email Configuration
The CMS email provider SHALL be configured via environment variables.

#### Scenario: Region configuration
- **GIVEN** `AWS_REGION` environment variable is set
- **WHEN** the email provider initializes
- **THEN** the SES client uses the configured region
- **AND** defaults to `us-east-1` if not set

#### Scenario: Default sender configuration
- **GIVEN** `SES_FROM_ADDRESS` environment variable is set
- **WHEN** an email is sent without explicit sender
- **THEN** the configured default sender address is used
- **AND** falls back to `cms@defcon.run` if not set

#### Scenario: Reply-to configuration
- **GIVEN** `SES_REPLYTO_ADDRESS` environment variable is set
- **WHEN** an email is sent without explicit reply-to
- **THEN** the configured default reply-to address is used

### Requirement: Email Functionality
The CMS email provider SHALL support standard Strapi email operations.

#### Scenario: Send email with HTML body
- **GIVEN** the email provider is configured
- **WHEN** an email is sent with HTML content
- **THEN** the email is delivered with HTML body via SES
- **AND** the recipient receives formatted content

#### Scenario: Send email with text body
- **GIVEN** the email provider is configured
- **WHEN** an email is sent with plain text content
- **THEN** the email is delivered with text body via SES

#### Scenario: Send email with multiple recipients
- **GIVEN** the email provider is configured
- **WHEN** an email is sent with multiple To/CC/BCC addresses
- **THEN** all recipients receive the email via SES

## Implementation Notes

### Provider Location
- Source: `apps/run.cms/app/providers/strapi-provider-email-aws-ses-v3/`
- Package name: `strapi-provider-email-aws-ses-v3`
- Entry point: `index.js`

### Dependencies
- Peer dependency: `@aws-sdk/client-ses` ^3.0.0
- Installed in main app `package.json`

### Configuration
In `config/plugins.ts`:
```typescript
email: {
  config: {
    provider: 'strapi-provider-email-aws-ses-v3',
    providerOptions: {
      region: env('AWS_REGION', 'us-east-1'),
    },
    settings: {
      defaultFrom: env('SES_FROM_ADDRESS', 'cms@defcon.run'),
      defaultReplyTo: env('SES_REPLYTO_ADDRESS', 'cms@defcon.run'),
    },
  },
}
```

### Security Rationale
Third-party Strapi email providers often have transitive dependencies with known vulnerabilities. By using a minimal custom provider that directly interfaces with AWS SDK v3, we:
- Eliminate unnecessary transitive dependencies
- Use AWS's officially maintained SDK
- Maintain full control over the email sending logic
- Reduce attack surface
