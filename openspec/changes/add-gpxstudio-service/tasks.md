# Tasks: Add GPX Studio Service

> **Architecture**: Next.js wrapper + modified gpx.studio frontend with S3 storage and OIDC authentication.

## Phase 1: Foundation Setup

### 1.1 Repository Structure
- [ ] 1.1.1 Create `apps/run.gpx/` directory structure
- [ ] 1.1.2 Add gpx.studio as git submodule at `apps/run.gpx/gpx-studio/`
  ```bash
  cd apps/run.gpx
  git submodule add https://github.com/gpxstudio/gpx.studio.git gpx-studio
  ```
- [ ] 1.1.3 Create `apps/run.gpx/patches/` directory for modification patches
- [ ] 1.1.4 Create `apps/run.gpx/webapp/` Next.js application scaffold
- [ ] 1.1.5 Create `apps/run.gpx/VERSION` file (initial: v0.0.1)
- [ ] 1.1.6 Create `apps/run.gpx/README.md` with build instructions

### 1.2 Next.js Backend Setup
- [ ] 1.2.1 Initialize Next.js project in `apps/run.gpx/webapp/`
  ```bash
  npx create-next-app@latest webapp --typescript --tailwind --app --src-dir
  ```
- [ ] 1.2.2 Install dependencies:
  - `next-auth` - OIDC authentication
  - `@aws-sdk/client-s3` - S3 operations
  - `@aws-sdk/s3-request-presigner` - Presigned URLs
  - `electrodb` - DynamoDB ORM
  - `@aws-sdk/client-dynamodb` - DynamoDB client
  - `uuid` - File ID generation
- [ ] 1.2.3 Configure TypeScript with strict mode
- [ ] 1.2.4 Set up ESLint and Prettier (match run.human config)

## Phase 2: Authentication Integration

### 2.1 OIDC Client Registration
- [ ] 2.1.1 Add SSM parameters for gpxstudio OIDC credentials:
  - `/dc34/secrets/us-east-1/gpxstudio/oidc_client_id`
  - `/dc34/secrets/us-east-1/gpxstudio/oidc_client_secret`
  - `/dc34/secrets/us-east-1/gpxstudio/nextauth_secret`
- [ ] 2.1.2 Update `apps/run.auth/webapp/src/config/oidc.ts`:
  - Add `gpxStudio` to clients configuration
  - Set client_id from config
  - Set redirect_uris: `https://gpxstudio.defcon.run/api/auth/callback/run.defcon.run`
  - Set post_logout_redirect_uris: `https://gpxstudio.defcon.run`
  - Include scope: `openid profile email services`

### 2.2 Auth.js Configuration
- [ ] 2.2.1 Create `apps/run.gpx/webapp/src/config/auth.ts`:
  - Configure OIDC provider pointing to auth.defcon.run
  - Set up JWT callback to extract services claim AND mapboxPublicToken
  - Set up session callback to expose services and mapbox token to client
- [ ] 2.2.2 Create `apps/run.gpx/webapp/src/app/api/auth/[...nextauth]/route.ts`
- [ ] 2.2.3 Create auth middleware for service claim validation
- [ ] 2.2.4 Create `apps/run.gpx/webapp/src/app/access-denied/page.tsx` for unauthorized users

### 2.3 Auth Service Updates
- [ ] 2.3.1 Add `gpxStudio` client config to `apps/run.auth/webapp/src/config/index.ts`
- [ ] 2.3.2 Add `mapboxPublicToken` field to AuthProfile entity:
  ```typescript
  mapboxPublicToken: {
    type: "string",
    required: false,
  }
  ```
- [ ] 2.3.3 Include `mapboxPublicToken` in OIDC claims when present
- [ ] 2.3.4 Rebuild and deploy auth service with new OIDC client

### 2.4 Mapbox Hybrid Token Implementation
- [ ] 2.4.1 Create Mapbox token resolution utility:
  ```typescript
  // apps/run.gpx/webapp/src/lib/mapbox-token.ts
  function resolveMapboxToken(userToken?: string): string {
    // 1. User's personal token takes precedence
    // 2. Fall back to MAPBOX_DEFAULT_TOKEN from env
    return userToken || process.env.MAPBOX_DEFAULT_TOKEN!;
  }
  ```
- [ ] 2.4.2 Create Mapbox token validation utility:
  ```typescript
  // apps/run.gpx/webapp/src/lib/mapbox-validator.ts
  async function validateMapboxToken(token: string): Promise<ValidationResult>
  ```
  - Check format starts with `pk.`
  - Reject `sk.*` tokens with clear error
  - Test token with Mapbox API call
  - Return specific error messages
- [ ] 2.4.3 Create API endpoint for optional personal token:
  - `POST /api/profile/mapbox-token` - Validate and save personal token
  - `DELETE /api/profile/mapbox-token` - Remove personal token (revert to default)
- [ ] 2.4.4 Create profile settings UI component for Mapbox token:
  - Show current status: "Using default token" or "Using personal token"
  - Optional input field for personal token with validation feedback
  - Step-by-step setup instructions for users who want their own
  - Links to Mapbox signup and token creation
  - Clear button to revert to default token
- [ ] 2.4.5 Create GPX Studio token loader:
  - Fetch user profile to check for personal `mapboxPublicToken`
  - If present, use user's token; otherwise use default from env
  - Pass resolved token to frontend for Mapbox GL init

## Phase 3: Storage Layer

### 3.1 S3 Bucket Setup
- [ ] 3.1.1 Update `infra/terraform/live/site/site.hcl` to add run-gpx upload bucket:
  ```hcl
  {
    name = "run-gpx"
    service_name = "run-gpx"
    regions = ["us-east-1", "ca-central-1"]
    lifecycle = { uploads_expire_days = 0, enable_versioning = true }
    replication = { enabled = true }
    full_bucket_access = false
    cloudfront_access = false
  }
  ```
- [ ] 3.1.2 Run `terragrunt apply` for s3-uploads module to create bucket
- [ ] 3.1.3 Verify SSM parameters created for bucket credentials

### 3.2 DynamoDB Entity
- [ ] 3.2.1 Create `apps/run.gpx/webapp/src/entities/gpx-file.ts`:
  - Define GpxFile entity with ElectroDB
  - Attributes: userId, fileId, fileName, bucket, key, fileSize, metadata
  - Indexes: byUser (pk: userId, sk: createdAt)
- [ ] 3.2.2 Create `apps/run.gpx/webapp/src/entities/gpx-composition.ts`:
  - Define GpxComposition entity for multi-file projects
  - Attributes: userId, compositionId, name, fileIds, settings
- [ ] 3.2.3 Add DynamoDB table to infrastructure or use existing run-human table with new entity

### 3.3 S3 Client and API Routes
- [ ] 3.3.1 Create `apps/run.gpx/webapp/src/lib/s3-client.ts`:
  - Initialize S3Client with credentials from env
  - Export getUserPrefix helper function
- [ ] 3.3.2 Create `apps/run.gpx/webapp/src/app/api/gpx/files/route.ts`:
  - GET: List user's GPX files from DynamoDB
  - POST: Create new file record, return presigned upload URL
- [ ] 3.3.3 Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/route.ts`:
  - GET: Get file metadata and presigned download URL
  - PUT: Update file metadata
  - DELETE: Delete file from S3 and DynamoDB
- [ ] 3.3.4 Create `apps/run.gpx/webapp/src/app/api/gpx/upload/presign/route.ts`:
  - POST: Generate presigned PUT URL for direct S3 upload
- [ ] 3.3.5 Create `apps/run.gpx/webapp/src/app/api/gpx/download/presign/route.ts`:
  - POST: Generate presigned GET URL for direct S3 download
- [ ] 3.3.6 Create `apps/run.gpx/webapp/src/app/api/health/route.ts`:
  - GET: Health check endpoint for load balancer

## Phase 4: GPX Studio Frontend Modifications

### 4.1 Storage Adapter
- [ ] 4.1.1 Analyze gpx.studio's Dexie storage implementation in `website/src/lib/db/`
- [ ] 4.1.2 Create patch `001-storage-adapter.patch`:
  - Add `api-adapter.ts` with API-based storage implementation
  - Modify `index.ts` to use API adapter instead of Dexie
  - Keep Dexie types for compatibility
- [ ] 4.1.3 Implement file operations in adapter:
  - `listFiles()` - Call GET /api/gpx/files
  - `saveFile()` - Get presigned URL, upload to S3
  - `loadFile()` - Get presigned URL, download from S3
  - `deleteFile()` - Call DELETE /api/gpx/files/{id}
- [ ] 4.1.4 Implement composition operations if needed

### 4.2 Auth Integration
- [ ] 4.2.1 Create patch `002-auth-integration.patch`:
  - Add auth store in `website/src/lib/stores/auth.ts`
  - Modify `+layout.svelte` to check auth state
  - Add loading state while checking authentication
  - Redirect to login if not authenticated
- [ ] 4.2.2 Add logout button to gpx.studio UI
- [ ] 4.2.3 Handle session expiration gracefully

### 4.3 Branding
- [ ] 4.3.1 Create patch `003-branding.patch`:
  - Update title to "GPX Studio - DEF CON"
  - Add DEF CON logo/branding to header
  - Update favicon
- [ ] 4.3.2 Customize color scheme if desired (optional)

### 4.4 Build Integration
- [ ] 4.4.1 Create `apps/run.gpx/build-frontend.sh`:
  - Apply patches to gpx.studio submodule
  - Install gpx.studio dependencies
  - Build gpx.studio (npm run build)
  - Copy build output to webapp/public/gpx/
- [ ] 4.4.2 Update `apps/run.gpx/webapp/next.config.js`:
  - Configure rewrites for /gpx/* to serve static files
  - Or configure as catch-all for SPA

## Phase 5: Docker Container

### 5.1 Dockerfile
- [ ] 5.1.1 Create `apps/run.gpx/Dockerfile`:
  ```dockerfile
  # Stage 1: Build gpx.studio frontend
  FROM node:22-alpine AS gpx-builder
  # ... apply patches, build frontend

  # Stage 2: Build Next.js backend
  FROM node:22-alpine AS app-builder
  # ... copy frontend, build Next.js

  # Stage 3: Production runtime
  FROM node:22-alpine
  # ... copy built assets, configure runtime
  ```
- [ ] 5.1.2 Add healthcheck to Dockerfile
- [ ] 5.1.3 Create `.dockerignore` to exclude unnecessary files

### 5.2 Build Scripts
- [ ] 5.2.1 Create `apps/run.gpx/build.sh`:
  - Read VERSION file
  - Build Docker image
  - Tag with version
  - Push to ECR
- [ ] 5.2.2 Create `apps/run.gpx/deploy.sh`:
  - Copy VERSION to Terraform directory
  - Run terragrunt apply
- [ ] 5.2.3 Create `apps/run.gpx/version.sh`:
  - Increment patch version

## Phase 6: Infrastructure

### 6.1 Terraform Configuration
- [ ] 6.1.1 Create `infra/terraform/live/site/services/run-gpx/` directory
- [ ] 6.1.2 Create `infra/terraform/live/site/services/run-gpx/service.hcl`:
  - ECR repository: run-gpx-webapp
  - ECS task definition with container config
  - ECS service with ALB integration
  - Environment variables and secrets
- [ ] 6.1.3 Create `infra/terraform/live/site/services/run-gpx/terragrunt.hcl`:
  - Include service.hcl
  - Configure dependencies
- [ ] 6.1.4 Create VERSION symlinks for Terraform

### 6.2 ALB and CloudFront
- [ ] 6.2.1 Add ALB listener rule for gpxstudio.defcon.run
- [ ] 6.2.2 Add CloudFront distribution or origin for gpxstudio subdomain
- [ ] 6.2.3 Configure SSL certificate for gpxstudio.defcon.run

### 6.3 DNS
- [ ] 6.3.1 Add Route 53 record for gpxstudio.defcon.run
- [ ] 6.3.2 Point to CloudFront distribution

## Phase 7: Testing and Validation

### 7.1 Local Development
- [ ] 7.1.1 Test Next.js backend locally:
  - Auth flow with local auth.defcon.run
  - S3 presigned URL generation
  - DynamoDB operations
- [ ] 7.1.2 Test gpx.studio frontend locally:
  - File save/load via API
  - Auth state handling
  - Logout flow
- [ ] 7.1.3 Test full integration locally via Docker

### 7.2 Staging Deployment
- [ ] 7.2.1 Deploy to us-east-1
- [ ] 7.2.2 Verify OIDC authentication flow
- [ ] 7.2.3 Test with user who has `gpxstudio` service - should work
- [ ] 7.2.4 Test with user without `gpxstudio` service - should see access denied
- [ ] 7.2.5 Test GPX file operations:
  - Create new GPX file
  - Edit and save GPX file
  - Load existing GPX file
  - Delete GPX file
- [ ] 7.2.6 Test map rendering with Mapbox
- [ ] 7.2.7 Verify S3 files are stored under user's prefix

### 7.3 Production Readiness
- [ ] 7.3.1 Review security:
  - OIDC client credentials in SSM
  - S3 bucket policies
  - Service claim validation
- [ ] 7.3.2 Add monitoring and alerting
- [ ] 7.3.3 Document operational procedures

## Phase 8: Documentation

### 8.1 User Documentation
- [ ] 8.1.1 Create user guide for gpxstudio.defcon.run
- [ ] 8.1.2 Document how to request gpxstudio access (add to services claim)
- [ ] 8.1.3 Document optional personal Mapbox token setup in profile

### 8.2 Developer Documentation
- [ ] 8.2.1 Document build process and patch management
- [ ] 8.2.2 Document how to update gpx.studio submodule
- [ ] 8.2.3 Add to CLAUDE.md or AGENTS.md if needed

## Phase 9: Manual Secrets Setup (Operator Task)

> **Note**: This phase requires manual intervention to add secrets to SOPS.
> These steps should be performed by an operator with SOPS access.

### 9.1 Create Mapbox Default Token
- [ ] 9.1.1 Create Mapbox account (if not exists) at https://mapbox.com
- [ ] 9.1.2 Create a new public token for gpxstudio:
  - Name: `defcon-gpxstudio-default`
  - URL restrictions: `gpxstudio.defcon.run`
  - Scopes: Default (Maps, Geocoding)
- [ ] 9.1.3 Copy the token (starts with `pk.`)

### 9.2 Add Secrets to SOPS
- [ ] 9.2.1 Add gpxstudio secrets to SOPS encrypted file:
  ```yaml
  gpxstudio:
    oidc_client_id: "gpxstudio"
    oidc_client_secret: "<generate-secure-secret>"
    nextauth_secret: "<generate-secure-secret>"
    mapbox_default_token: "pk.<your-token-here>"
  ```
- [ ] 9.2.2 Run SOPS encryption and commit changes

### 9.3 Sync to SSM
- [ ] 9.3.1 Deploy secrets to SSM Parameter Store:
  - `/dc34/secrets/us-east-1/gpxstudio/oidc_client_id`
  - `/dc34/secrets/us-east-1/gpxstudio/oidc_client_secret`
  - `/dc34/secrets/us-east-1/gpxstudio/nextauth_secret`
  - `/dc34/secrets/us-east-1/gpxstudio/mapbox_default_token`
- [ ] 9.3.2 Verify SSM parameters are accessible

### 9.4 Register OIDC Client
- [ ] 9.4.1 Add gpxstudio client credentials to auth.defcon.run config
- [ ] 9.4.2 Redeploy auth service to register the new OIDC client

---

## Implementation Notes

### Patch Management

Keep patches minimal and focused. Each patch should modify the minimum necessary files:

```bash
# Create a patch after making changes in gpx-studio/
cd apps/run.gpx/gpx-studio
git diff > ../patches/001-storage-adapter.patch

# Apply patches during build
cd apps/run.gpx/gpx-studio
git apply ../patches/*.patch
```

### Service Claim Validation

Every API route should validate the `gpxstudio` service claim:

```typescript
import { auth } from '@/config/auth';

export async function GET() {
  const session = await auth();

  if (!session?.user?.services?.includes('gpxstudio')) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // ... handle request
}
```

### S3 Key Structure

All user files use predictable paths for easy management:

```
uploads/{userId}/gpx/{fileId}.gpx
uploads/{userId}/compositions/{compositionId}.json
```

### Error Handling

Provide clear error messages for common issues:
- No session: Redirect to login
- Missing service claim: Show access denied page with instructions
- S3 errors: Show retry option, log for debugging
- Network errors: Show offline indicator
