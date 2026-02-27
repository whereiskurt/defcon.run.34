# Change: Add GPX Studio Service with OIDC and User Storage

## Why

DEF CON runners need a collaborative GPX editing tool for planning and sharing routes. The open-source [gpx.studio](https://github.com/gpxstudio/gpx.studio) provides excellent GPX editing capabilities but stores data only in browser IndexedDB. We need a self-hosted version at `gpxstudio.defcon.run` that integrates with our OIDC authentication and persists user GPX compositions to their private S3 storage folders.

## What Changes

- **NEW** `apps/run.gpx/` - Forked and modified gpx.studio application
- **NEW** Backend API layer for authentication and S3 storage operations
- **NEW** OIDC client registration for `gpxstudio` in auth.defcon.run
- **NEW** `gpxstudio` service claim for access control
- **NEW** S3 bucket for GPX file storage with user-isolated prefixes
- **NEW** Infrastructure: ECR, ECS task, ALB routing, CloudFront origin
- **NEW** DynamoDB entity for tracking user GPX files
- **MODIFIED** Auth profile schema to support `gpxstudio` in services array

## Implementation Approach

Two architectural options are viable (see design.md for detailed trade-offs):

### Option A: Wrapper Architecture (Recommended)
Create a Next.js wrapper application (`apps/run.gpx/`) that:
- Handles OIDC authentication via Auth.js (same pattern as run.human)
- Validates `gpxstudio` service claim
- Provides API endpoints for S3 presigned URLs
- Embeds modified gpx.studio frontend as static assets
- Modifies gpx.studio's storage layer to call our API instead of IndexedDB

### Option B: Native SvelteKit Modification
Modify gpx.studio's SvelteKit application directly:
- Switch from static adapter to Node adapter for SSR
- Add server-side OIDC authentication
- Replace Dexie storage with S3 API calls
- Deploy as containerized SvelteKit app

**Recommendation**: Option A provides better consistency with existing services, simpler maintenance of upstream updates, and proven auth patterns.

## Impact

- **Affected specs**: None (new capability)
- **New spec**: `gpxstudio/spec.md` - GPX Studio service specification
- **Affected code**:
  - `apps/run.gpx/` - New service directory (fork + modifications)
  - `apps/run.auth/webapp/src/config/oidc.ts` - Add gpxstudio OIDC client
  - `infra/terraform/live/site/services/run-gpx/` - New service infrastructure
  - `infra/terraform/live/site/site.hcl` - Add S3 bucket configuration
- **Infrastructure changes**:
  - New ECR repository: `run-gpx-webapp`
  - New ECS service: `run-gpx-webapp`
  - New S3 bucket: `uploads-dc34-run-gpx-{region}`
  - New ALB listener rules for `gpxstudio.defcon.run`
  - New CloudFront behavior for gpxstudio subdomain
  - New DynamoDB table or extension for GPX file metadata
- **DNS**: New subdomain `gpxstudio.defcon.run` pointing to CloudFront

## Dependencies

- Requires `add-strapi-cms` pattern understanding for containerization
- Requires Mapbox API token (can share existing or create new)
- Requires upstream gpx.studio fork management strategy
