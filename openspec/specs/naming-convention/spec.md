# naming-convention Specification

## Purpose
Standard naming conventions for services, directories, containers, and AWS resources across the defcon.run project.

## Requirements

### Requirement: Standard Service Naming Pattern
All services MUST use consistent naming: `run.{service}` for directories (dot notation) and `run-{service}` for hyphenated contexts. AWS resources MUST include the site label prefix (e.g., `dc34-`) where appropriate.

#### Scenario: Directory naming
- **GIVEN** a service named "auth"
- **WHEN** referencing the source directory
- **THEN** use `run.auth` (dot separator, no site prefix)

#### Scenario: Docker container naming (local dev)
- **GIVEN** a local development container for auth
- **WHEN** defining the container name
- **THEN** use `run-auth-localhost` (no site prefix for local dev)

#### Scenario: ECR repository naming (AWS)
- **GIVEN** an ECR repository for auth
- **WHEN** naming the repository
- **THEN** use `dc34-run-auth-app` (site prefix + run- + service + component)

#### Scenario: ECS task and service naming (AWS)
- **GIVEN** an ECS service for auth
- **WHEN** naming the service and task family
- **THEN** use `run-auth` (no site prefix; ECS cluster provides site context)

#### Scenario: S3 bucket naming (AWS)
- **GIVEN** an S3 bucket for CMS media
- **WHEN** naming the bucket
- **THEN** use pattern `dc34-run-cms-media-{region}-{suffix}` (site prefix first)

### Requirement: Region Abbreviation Convention
Regions MUST use standard abbreviations in URLs, resource names, and configurations.

#### Scenario: AWS region abbreviations
- **GIVEN** a multi-region deployment
- **WHEN** referencing regions
- **THEN** use `use1` for us-east-1, `cac1` for ca-central-1, `apse1` for ap-southeast-1

#### Scenario: Site label
- **GIVEN** the defcon.run 34 project
- **WHEN** a site label is needed
- **THEN** use `dc34`

### Requirement: Prohibited Naming Patterns
Legacy naming patterns MUST NOT be used to prevent confusion.

#### Scenario: No reversed order
- **WHEN** choosing between `human-run` and `run-human`
- **THEN** use `run-human` (run- prefix, not -run suffix)

#### Scenario: No service without run prefix
- **WHEN** choosing between `auth` and `run-auth`
- **THEN** use `run-auth` (always include run- prefix)

## Implementation Notes

### Current Services
| Service | Directory | Hyphenated | Domain |
|---------|-----------|------------|--------|
| Auth | run.auth | run-auth | auth.defcon.run |
| Human | run.human | run-human | run.defcon.run |
| GPX | run.gpx | run-gpx | gpx.defcon.run |
| CMS | run.cms | run-cms | cms.defcon.run |
