# Naming Convention

## ADDED Requirements

### Requirement: Standard service naming pattern
All services MUST use consistent naming: `run.{service}` for directories (dot notation) and `run-{service}` for hyphenated contexts. AWS resources MUST include the site label prefix (e.g., `dc34-`) where appropriate.

#### Scenario: Directory naming
Given a service named "auth"
When referencing the source directory
Then use `run.auth` (with dot separator, no site prefix)

#### Scenario: Docker container naming (local dev)
Given a local development container for auth
When defining the container name
Then use `run-auth-localhost` (no site prefix for local dev)

#### Scenario: ECR repository naming (AWS)
Given an ECR repository for auth app
When naming the repository
Then use `dc34-run-auth-app` (site prefix + run- + service + component)

#### Scenario: ECS task and service naming (AWS)
Given an ECS service for auth
When naming the service and task family
Then use `run-auth` as the name (no site prefix - ECS cluster provides site context)

#### Scenario: S3 bucket naming (AWS)
Given an S3 bucket for CMS media
When naming the bucket
Then use pattern `dc34-run-cms-media-{region}-{suffix}` (site prefix first)

### Requirement: Prohibited naming patterns
Legacy naming patterns MUST NOT be used to prevent confusion.

#### Scenario: No reversed order
Given a need to name a Docker container
When choosing between `human-run` and `run-human`
Then use `run-human` (run- prefix, not -run suffix)

#### Scenario: No service without run prefix
Given a need to name an ECS service for auth
When choosing between `auth` and `run-auth`
Then use `run-auth` (always include run- prefix)
