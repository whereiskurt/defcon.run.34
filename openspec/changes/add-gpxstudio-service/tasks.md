# Tasks: Add GPX Studio Service

> **Architecture**: Next.js wrapper + modified gpx.studio frontend with S3 storage and OIDC authentication.

## Phase 1: Foundation Setup

### 1.1 Repository Structure
- [x] 1.1.1 Create `apps/run.gpx/` directory structure
- [x] 1.1.2 Add gpx.studio as git submodule at `apps/run.gpx/gpx-studio/`
  ```bash
  cd apps/run.gpx
  git submodule add https://github.com/gpxstudio/gpx.studio.git gpx-studio
  ```
- [x] 1.1.3 Create `apps/run.gpx/patches/` directory for modification patches
- [x] 1.1.4 Create `apps/run.gpx/webapp/` Next.js application scaffold
- [x] 1.1.5 Create `apps/run.gpx/VERSION` file (initial: v0.0.1)
- [x] 1.1.6 Create `apps/run.gpx/README.md` with build instructions

### 1.2 Next.js Backend Setup
- [x] 1.2.1 Initialize Next.js project in `apps/run.gpx/webapp/`
- [x] 1.2.2 Install dependencies:
  - `next-auth` - OIDC authentication
  - `@aws-sdk/client-s3` - S3 operations
  - `@aws-sdk/s3-request-presigner` - Presigned URLs
  - `electrodb` - DynamoDB ORM
  - `@aws-sdk/client-dynamodb` - DynamoDB client
  - `uuid` - File ID generation
- [x] 1.2.3 Configure TypeScript with strict mode
- [ ] 1.2.4 Set up ESLint and Prettier (match run.human config)

## Phase 2: Authentication Integration

### 2.1 OIDC Client Registration
- [ ] 2.1.1 Add SSM parameters for gpxstudio OIDC credentials:
  - `/dc34/secrets/us-east-1/gpxstudio/oidc_client_id`
  - `/dc34/secrets/us-east-1/gpxstudio/oidc_client_secret`
  - `/dc34/secrets/us-east-1/gpxstudio/nextauth_secret`
- [x] 2.1.2 Update `apps/run.auth/webapp/src/config/oidc.ts`:
  - Add `gpxStudio` to clients configuration
  - Set client_id from config
  - Set redirect_uris: `https://gpxstudio.defcon.run/api/auth/callback/run.defcon.run`
  - Set post_logout_redirect_uris: `https://gpxstudio.defcon.run`
  - Include scope: `openid profile email services`

### 2.2 Auth.js Configuration
- [x] 2.2.1 Create `apps/run.gpx/webapp/src/config/auth.ts`:
  - Configure OIDC provider pointing to auth.defcon.run
  - Set up JWT callback to extract services claim AND mapboxPublicToken
  - Set up session callback to expose services and mapbox token to client
- [x] 2.2.2 Create `apps/run.gpx/webapp/src/app/api/auth/[...nextauth]/route.ts`
- [x] 2.2.3 Create auth middleware for service claim validation
- [ ] 2.2.4 Create `apps/run.gpx/webapp/src/app/access-denied/page.tsx` for unauthorized users

### 2.3 Auth Service Updates
- [x] 2.3.1 Add `gpxStudio` client config to `apps/run.auth/webapp/src/config/index.ts`
- [x] 2.3.2 Add `mapboxPublicToken` field to AuthProfile entity
- [x] 2.3.3 Include `mapboxPublicToken` in OIDC claims when present
- [ ] 2.3.4 Rebuild and deploy auth service with new OIDC client

### 2.4 Mapbox Hybrid Token Implementation
- [ ] 2.4.1 Create Mapbox token resolution utility
- [ ] 2.4.2 Create Mapbox token validation utility
- [ ] 2.4.3 Create API endpoint for optional personal token
- [ ] 2.4.4 Create profile settings UI component for Mapbox token
- [ ] 2.4.5 Create GPX Studio token loader

## Phase 3: Storage Layer

### 3.1 S3 Bucket Setup
- [x] 3.1.1 Update `infra/terraform/live/site/site.hcl` to add run-gpx upload bucket
- [ ] 3.1.2 Run `terragrunt apply` for s3-uploads module to create bucket
- [ ] 3.1.3 Verify SSM parameters created for bucket credentials

### 3.2 DynamoDB Entity
- [x] 3.2.1 Create `apps/run.gpx/webapp/src/entities/gpx-file.ts`:
  - Define GpxFile entity with ElectroDB
  - Attributes: userId, fileId, fileName, bucket, key, fileSize, metadata
  - Indexes: byUser (pk: userId, sk: createdAt)
- [ ] 3.2.2 Create `apps/run.gpx/webapp/src/entities/gpx-composition.ts` (deferred to v2)
- [x] 3.2.3 Add DynamoDB table to infrastructure or use existing run-human table with new entity

### 3.3 S3 Client and API Routes
- [x] 3.3.1 Create `apps/run.gpx/webapp/src/lib/s3-client.ts`:
  - Initialize S3Client with credentials from env
  - Export getUserPrefix helper function
- [x] 3.3.2 Create `apps/run.gpx/webapp/src/app/api/gpx/files/route.ts`:
  - GET: List user's GPX files from DynamoDB
  - POST: Create new file record, return presigned upload URL
- [x] 3.3.3 Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/route.ts`:
  - GET: Get file metadata and presigned download URL
  - PUT: Update file metadata
  - DELETE: Delete file from S3 and DynamoDB
- [x] 3.3.4 Create `apps/run.gpx/webapp/src/app/api/gpx/upload/presign/route.ts`:
  - POST: Generate presigned PUT URL for direct S3 upload
- [x] 3.3.5 Create `apps/run.gpx/webapp/src/app/api/gpx/download/presign/route.ts`:
  - POST: Generate presigned GET URL for direct S3 download
- [x] 3.3.6 Create `apps/run.gpx/webapp/src/app/api/health/route.ts`:
  - GET: Health check endpoint for load balancer

## Phase 4: GPX Studio Frontend Modifications

### 4.1 Storage Adapter
- [x] 4.1.1 Analyze gpx.studio's Dexie storage implementation in `website/src/lib/db/`
- [x] 4.1.2 Create cloud-sync.ts with API-based storage implementation
- [x] 4.1.3 Implement file operations in adapter:
  - `listCloudFiles()` - Call GET /api/gpx/files
  - `saveToCloud()` - Get presigned URL, upload to S3
  - `loadFromCloud()` - Get presigned URL, download from S3
  - `deleteFromCloud()` - Call DELETE /api/gpx/files/{id}
- [ ] 4.1.4 Implement composition operations if needed (deferred to v2)

### 4.2 Auth Integration
- [x] 4.2.1 Create auth store in `website/src/lib/stores/auth.ts`
  - Add auth state management
  - Check for gpxstudio service claim
  - Provide login/logout functions
- [x] 4.2.2 Create CloudStorage dialog component
- [ ] 4.2.3 Handle session expiration gracefully

### 4.3 Branding
- [ ] 4.3.1 Create patch `003-branding.patch`:
  - Update title to "GPX Studio - DEF CON"
  - Add DEF CON logo/branding to header
  - Update favicon
- [ ] 4.3.2 Customize color scheme if desired (optional)

### 4.4 Build Integration
- [x] 4.4.1 Create `apps/run.gpx/build-frontend.sh`:
  - Apply patches to gpx.studio submodule
  - Install gpx.studio dependencies
  - Build gpx.studio with BASE_PATH=/gpx-studio
  - Copy build output to webapp/public/gpx-studio/
- [x] 4.4.2 Update `apps/run.gpx/webapp/next.config.ts`:
  - Configure rewrites for /gpx-studio/* to serve static files
  - Add BRouter proxy rewrite

## Phase 5: Docker Container

### 5.1 Dockerfile
- [ ] 5.1.1 Create `apps/run.gpx/Dockerfile`
- [ ] 5.1.2 Add healthcheck to Dockerfile
- [ ] 5.1.3 Create `.dockerignore` to exclude unnecessary files

### 5.2 Build Scripts
- [x] 5.2.1 Create `apps/run.gpx/build.sh`
- [x] 5.2.2 Create `apps/run.gpx/deploy.sh`
- [ ] 5.2.3 Create `apps/run.gpx/version.sh`

## Phase 6: Infrastructure

### 6.1 Terraform Configuration
- [ ] 6.1.1 Create `infra/terraform/live/site/services/run-gpx/` directory
- [ ] 6.1.2 Create `infra/terraform/live/site/services/run-gpx/service.hcl`
- [ ] 6.1.3 Create `infra/terraform/live/site/services/run-gpx/terragrunt.hcl`
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
- [x] 7.1.1 Test Next.js backend locally:
  - Auth flow with local auth.defcon.run
  - S3 presigned URL generation (MinIO)
  - DynamoDB operations (DynamoDB Local)
- [x] 7.1.2 Test gpx.studio frontend locally:
  - File save/load via API
  - Auth state handling
  - Logout flow
- [ ] 7.1.3 Test full integration locally via Docker

### 7.2 Staging Deployment
- [ ] 7.2.1 Deploy to us-east-1
- [ ] 7.2.2 Verify OIDC authentication flow
- [ ] 7.2.3 Test with user who has `gpxstudio` service - should work
- [ ] 7.2.4 Test with user without `gpxstudio` service - should see access denied
- [ ] 7.2.5 Test GPX file operations
- [ ] 7.2.6 Test map rendering with Mapbox
- [ ] 7.2.7 Verify S3 files are stored under user's prefix

### 7.3 Production Readiness
- [ ] 7.3.1 Review security
- [ ] 7.3.2 Add monitoring and alerting
- [ ] 7.3.3 Document operational procedures

## Phase 8: Documentation

### 8.1 User Documentation
- [ ] 8.1.1 Create user guide for gpxstudio.defcon.run
- [ ] 8.1.2 Document how to request gpxstudio access
- [ ] 8.1.3 Document optional personal Mapbox token setup

### 8.2 Developer Documentation
- [ ] 8.2.1 Document build process and patch management
- [ ] 8.2.2 Document how to update gpx.studio submodule
- [ ] 8.2.3 Add to CLAUDE.md or AGENTS.md if needed

## Phase 9: Manual Secrets Setup (Operator Task)

> **Note**: This phase requires manual intervention to add secrets to SOPS.

### 9.1 Create Mapbox Default Token
- [ ] 9.1.1 Create Mapbox account (if not exists)
- [ ] 9.1.2 Create a new public token for gpxstudio
- [ ] 9.1.3 Copy the token (starts with `pk.`)

### 9.2 Add Secrets to SOPS
- [ ] 9.2.1 Add gpxstudio secrets to SOPS encrypted file
- [ ] 9.2.2 Run SOPS encryption and commit changes

### 9.3 Sync to SSM
- [ ] 9.3.1 Deploy secrets to SSM Parameter Store
- [ ] 9.3.2 Verify SSM parameters are accessible

### 9.4 Register OIDC Client
- [ ] 9.4.1 Add gpxstudio client credentials to auth.defcon.run config
- [ ] 9.4.2 Redeploy auth service to register the new OIDC client

---

## Implementation Notes

### Svelte 5 Compatibility

**Critical**: gpx.studio uses Svelte 5 with `$props()` and runes. This affects event handler syntax:

```svelte
<!-- WRONG (Svelte 4 style) - buttons won't respond to clicks -->
<Button on:click={handleClick}>Click me</Button>

<!-- CORRECT (Svelte 5 style) - use onclick prop -->
<Button onclick={handleClick}>Click me</Button>
```

The Button component uses `$props()` with `...restProps` spread, so event handlers must be passed as props, not using the `on:` directive syntax.

### Cross-Component State Management

**Issue**: Svelte 5's `$state()` rune doesn't work well with two-way binding (`bind:`) across component boundaries.

**Solution**: Use traditional Svelte stores (`writable`) for state shared between components:

```typescript
// WRONG - $state doesn't propagate across components
export const dialogState = $state({ open: false });

// CORRECT - writable store works across components
import { writable } from 'svelte/store';
export const dialogOpen = writable(false);
```

### Build Configuration

**BASE_PATH is required**: The SvelteKit build must set `BASE_PATH=/gpx-studio` so all asset URLs are prefixed correctly:

```bash
# In build-frontend.sh
BASE_PATH=/gpx-studio npm run build
```

Without this, the built HTML references `/_app/immutable/chunks/...` instead of `/gpx-studio/_app/immutable/chunks/...`, causing 404 errors.

### Local Development Setup

**Vite Proxy**: For local development with hot reload, add a proxy to gpx-studio's vite.config.ts:

```typescript
export default defineConfig({
  // ... other config
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
    },
  },
});
```

**Development servers**:
1. Next.js webapp on port 3003 (handles API routes)
2. gpx-studio Vite dev server on port 5173 (proxies /api/* to 3003)
3. Auth service on port 3002
4. MinIO on port 9000 (S3-compatible storage)
5. DynamoDB Local on port 8888

**MinIO CORS**: Configure CORS on MinIO for direct browser uploads:

```bash
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/run-gpx-uploads --ignore-existing
cat > /tmp/cors.json << 'EOF'
{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:3003"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}
EOF
mc cors set local/run-gpx-uploads /tmp/cors.json
```

### Key Files Modified

| File | Purpose |
|------|---------|
| `gpx-studio/website/src/lib/cloud-sync.ts` | API-based cloud storage functions |
| `gpx-studio/website/src/lib/stores/auth.ts` | Auth state management with session check |
| `gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte` | Cloud storage dialog UI |
| `gpx-studio/website/src/lib/components/cloud/utils.svelte.ts` | Dialog state (writable store) |
| `gpx-studio/website/src/lib/components/Menu.svelte` | Added Cloud Storage menu item |
| `gpx-studio/website/vite.config.ts` | Added dev proxy for API calls |
| `gpx-studio/website/svelte.config.js` | BASE_PATH configuration |
| `webapp/src/config/auth.ts` | OIDC configuration for Auth.js |
| `webapp/src/lib/s3-client.ts` | S3 client with MinIO support |
| `webapp/src/entities/gpx-file.ts` | ElectroDB entity for file metadata |
| `webapp/src/app/api/gpx/*/route.ts` | API routes for file operations |
| `build-frontend.sh` | Build script with BASE_PATH |

### Service Claim Validation

Every API route validates the `gpxstudio` service claim:

```typescript
import { auth } from '@/config/auth';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes('gpxstudio')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // ... handle request
}
```

### S3 Key Structure

All user files use predictable paths:

```
uploads/{userId}/gpx/{fileId}.gpx
```

### Error Handling

- No session: Redirect to login (`/api/auth/signin`)
- Missing service claim: Show access denied in dialog
- S3 errors: Show error message with retry option
- Network errors: Show error in dialog

### GPX File Serialization

**Critical**: Use `buildGPX(file)` from the `gpx` package, NOT `file.toString()`:

```typescript
// WRONG - returns "[object Object]"
const gpxContent = file.toString();

// CORRECT - returns valid GPX XML
import { buildGPX } from 'gpx';
const gpxContent = buildGPX(file);
```

The `fileStateCollection.getFile(fileId)` returns a GPXFile object. To serialize it to XML for upload, you must use `buildGPX()`.

### AWS SDK v3 Presigned URL Checksums

**Issue**: AWS SDK v3 adds CRC32 checksum headers to presigned URLs by default. Browsers cannot calculate these checksums, causing uploads to fail silently.

**Solution**: Create a separate S3 client for presigning with checksums disabled:

```typescript
// s3-client.ts
export const s3Client = new S3Client(baseConfig);

// For presigned URLs - no checksums for browser compatibility
export const s3ClientForPresign = new S3Client({
  ...baseConfig,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
```

Use `s3ClientForPresign` when generating presigned URLs for browser uploads.

### API Endpoint for File Creation

**Critical**: The frontend must call `POST /api/gpx/files` (not `/api/gpx/upload/presign`) to:
1. Create the DynamoDB metadata record
2. Get the presigned upload URL

```typescript
// cloud-sync.ts
// WRONG - only generates URL, no database record
const response = await fetch(`${API_BASE}/upload/presign`, ...);

// CORRECT - creates DB record AND returns presigned URL
const response = await fetch(`${API_BASE}/files`, {
  method: 'POST',
  body: JSON.stringify({ fileName, fileSize }),
  ...
});
```

Without this, files upload to S3 but aren't tracked in DynamoDB, so they won't appear in the file list.

### MinIO CORS Configuration

**Issue**: MinIO's `mc cors set` command requires XML format, not JSON.

```bash
# WRONG - JSON format causes "decoding xml: EOF" error
mc cors set local/bucket /tmp/cors.json

# CORRECT - XML format
cat > /tmp/cors.xml << 'EOF'
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
EOF
mc cors set local/run-gpx-uploads /tmp/cors.xml
```

The `apps/local/s3/init-s3-buckets.sh` script has been updated to use XML format.

### fileStateCollection API

The `fileStateCollection` does NOT have a `getFiles()` method. Use these instead:

```typescript
// Iterate all files
fileStateCollection.forEach((fileId, file) => {
  // file is GPXFile, not a wrapper
});

// Get single file by ID
const file = fileStateCollection.getFile(fileId);  // Returns GPXFile | undefined
```

### Cloud Storage Dialog UI Design

The Cloud Storage dialog (`CloudStorage.svelte`) follows these design patterns:

**Dialog Sizing**:
- Use `!` prefix to override shadcn Dialog's default `sm:max-w-lg`: `class="!max-w-[900px] !w-[90vw]"`
- Without `!`, Tailwind classes won't override the component's built-in styles

**Layout Structure**:
1. **Save button** - Large green button centered at top: "Save All Layers"
2. **File list table** - Columns: Name | Size | Updated | (Add to map) | Actions
3. **Refresh button** - Subtle ghost button below file list
4. **Close button** - In dialog footer

**Table Columns**:
| Column | Content |
|--------|---------|
| Name | File name with inline rename editing |
| Size | Compact format: `166kb` (not `166.4 KB`) |
| Updated | Natural language: "Today @ 2:30pm", "Yesterday @ 10:15am", or "20260111.142501" |
| (unlabeled) | Green outlined "add to map" button with Plus icon |
| Actions | Pencil (rename) and Trash (delete) icons |

**Date Formatting**:
```typescript
function formatDate(timestamp: number): string {
    // Today: "Today @ 2:30pm"
    // Yesterday: "Yesterday @ 10:15am"
    // Older: "20260111.142501" (YYYYMMDD.HHMMSS)
}
```

**File Size Formatting**:
```typescript
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}b`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}kb`;
    return `${Math.round(bytes / (1024 * 1024))}mb`;
}
```

**Inline Rename**:
- Click pencil icon to enter edit mode
- Input field replaces filename text
- Check (save) and X (cancel) buttons appear
- Enter to save, Escape to cancel
- Uses `updateCloudFile()` API to persist rename

**Loading File Uses Current Name**:
When loading a file from cloud, use `file.fileName` from the cloud file list (not the API response) to reflect any renames:
```typescript
gpx.metadata.name = file.fileName.replace(/\.gpx$/i, '');
```
