# Design: GPX Studio Service Integration

## Context

[GPX Studio](https://github.com/gpxstudio/gpx.studio) is an open-source SvelteKit application for editing GPX files. It currently:
- Builds to static files using `@sveltejs/adapter-static`
- Stores all data client-side in IndexedDB via Dexie
- Has no authentication (fully anonymous)
- Requires Mapbox GL token for map rendering
- Supports undo/redo via Immer patches

Our integration needs:
- OIDC authentication via auth.defcon.run
- Access control based on `gpxstudio` service claim
- Persistent storage to user-isolated S3 folders
- Multi-region deployment matching existing services

## Goals

- Self-hosted GPX editor at `gpx.defcon.run`
- SSO via auth.defcon.run (same login as run.defcon.run)
- User GPX files stored in S3 under `uploads/{userId}/gpx/`
- Access restricted to users with `gpxstudio` in services claim
- Maintain upstream compatibility for updates
- Support real-time collaboration (future enhancement)

## Non-Goals

- Forking all upstream dependencies
- Replacing Mapbox with alternative mapping provider
- Implementing custom GPX parsing library
- Supporting anonymous/guest access
- Multi-user simultaneous editing (v1)

## Decisions

### Decision: Wrapper Architecture with Next.js Backend

**Option A (Chosen)**: Next.js wrapper + modified gpx.studio frontend

**Rationale**:
1. **Consistency**: Matches run.human architecture (Next.js + Auth.js)
2. **Proven patterns**: S3 presigned URLs, OIDC integration already working
3. **Easier maintenance**: gpx.studio frontend updates are isolated changes
4. **Shared tooling**: Same build/deploy scripts, Docker patterns, monitoring
5. **Type safety**: TypeScript throughout with existing ElectroDB patterns

**Alternative Rejected**: Native SvelteKit modification
- Would require learning SvelteKit auth patterns
- Different deployment tooling needed
- Harder to maintain upstream compatibility
- Team less familiar with Svelte ecosystem

### Decision: Storage Architecture

**S3 Bucket Structure**:
```
uploads-dc34-run-gpx-{region}/
├── uploads/{userId}/
│   ├── gpx/
│   │   ├── {fileId}.gpx         # Raw uploaded/saved GPX files
│   │   └── {fileId}.gpx.meta    # Optional metadata JSON
│   └── compositions/
│       ├── {compositionId}.json  # Multi-file project state
│       └── {compositionId}/
│           └── {fileId}.gpx      # Files within composition
```

**DynamoDB Entity** (`GpxFile`):
```typescript
{
  userId: string;           // Partition key
  fileId: string;           // Sort key (UUID)
  fileName: string;         // User-facing name
  compositionId?: string;   // If part of a composition
  bucket: string;
  key: string;              // S3 key
  fileSize: number;

  // GPX metadata (extracted on save)
  trackCount: number;
  waypointCount: number;
  totalDistance: number;    // meters
  totalElevation: number;   // meters gained
  bounds: { minLat, maxLat, minLon, maxLon };

  // Timestamps
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}
```

### Decision: Frontend Integration Approach

**Submodule + Patch Strategy**:
1. Add gpx.studio as git submodule at `apps/run.gpx/gpx-studio/`
2. Create patch files for our modifications in `apps/run.gpx/patches/`
3. Build process applies patches, builds frontend, copies to public/
4. Keep patches minimal and focused on:
   - Storage layer abstraction (IndexedDB -> API calls)
   - Auth integration (session state, logout handling)
   - Branding (DEF CON theming, logos)

**Modified Files in gpx.studio**:
| File | Modification |
|------|--------------|
| `website/src/lib/db/index.ts` | Replace Dexie with API client |
| `website/src/lib/db/schema.ts` | Keep schema for type definitions |
| `website/src/lib/stores/` | Add auth state store |
| `website/src/routes/+layout.svelte` | Add auth wrapper |
| `website/src/routes/+page.svelte` | Check auth before rendering |
| `website/.env` | Point to our Mapbox token |

### Decision: API Endpoints

**Authentication** (handled by Auth.js middleware):
- Uses same OIDC flow as run.human
- Session stored in secure httpOnly cookie
- Service claim validation on protected routes

**Storage API** (`/api/gpx/`):
```
GET    /api/gpx/files           # List user's GPX files
GET    /api/gpx/files/{id}      # Get file metadata + download URL
POST   /api/gpx/files           # Create new file, returns presigned upload URL
PUT    /api/gpx/files/{id}      # Update file metadata
DELETE /api/gpx/files/{id}      # Delete file

GET    /api/gpx/compositions           # List compositions
POST   /api/gpx/compositions           # Create composition
GET    /api/gpx/compositions/{id}      # Get composition with files
PUT    /api/gpx/compositions/{id}      # Update composition
DELETE /api/gpx/compositions/{id}      # Delete composition and files

POST   /api/gpx/upload/presign         # Get presigned PUT URL
POST   /api/gpx/download/presign       # Get presigned GET URL
```

### Decision: Authentication Flow

```
1. User navigates to https://gpx.defcon.run/{region}/studio/app
2. Next.js middleware checks Auth.js session
3. If no session: Redirect to auth.defcon.run OIDC auth
   - scope: openid profile email services
   - redirect_uri: https://gpx.defcon.run/{region}/api/auth/callback/run.defcon.run
4. After OIDC callback, validate services claim:
   - If 'gpxstudio' not in services: Show access denied page
   - If present: Continue to app
5. Frontend loads with session context
6. API calls include session cookie automatically
7. Backend validates session + service claim on each request
```

### Decision: Multi-Region Deployment

**Multi-region deployment** (consistent with run.auth, run.human):
- Deploy to us-east-1 and ca-central-1
- CloudFront distribution serves globally
- S3 cross-region replication for data availability
- Regional path prefix: `/use1/` or `/cac1/` (required)

**URL Structure**:
- Production: `gpx.defcon.run/{region}/studio/app`
- Examples:
  - `https://gpx.defcon.run/use1/studio/app` (US East)
  - `https://gpx.defcon.run/cac1/studio/app` (Canada Central)

**Decision**: Use regional prefixes for consistency across all services:
- Consistent deployment patterns and build scripts
- Clear regional routing for debugging and observability
- Alignment with CloudFront/ALB origin path patterns
- Same basePath pattern as run.auth and run.human

### Decision: Service Claim Value

Use `gpxstudio` as the service claim value:
- Descriptive and matches subdomain
- Easily added to user profiles via admin tools
- Consistent with existing pattern (`auth`, `run`, `strava`, `cms`)

**Default services for new users**: `["auth", "run", "strava"]` (unchanged)
**GPX access**: Requires explicit addition of `gpxstudio` to user's services

### Decision: Mapbox Hybrid (Default + Optional BYOK)

**Provide a default Mapbox token with optional user override**:
- Low friction for casual users (works immediately)
- Power users can optionally provide their own token
- Default token stored in SOPS/SSM, injected via environment variable
- If user has token in profile, prefer theirs; otherwise use default

**Token Resolution Order**:
1. User's `mapboxPublicToken` from AuthProfile (if set)
2. Default `MAPBOX_DEFAULT_TOKEN` from environment (fallback)

**Implementation**:
- Add `mapboxPublicToken` field to AuthProfile entity (optional)
- Add `MAPBOX_DEFAULT_TOKEN` environment variable from SSM
- On app load: check user profile first, fall back to default
- Validate user tokens before saving (format + API test)
- Reject secret tokens (`sk.*`) with clear error

**User Experience**:
- First access: Works immediately with default token
- Optional setup: Users can add their own token in profile settings
- Token validation gives immediate feedback when user provides their own
- User tokens persist across sessions

**Cost Management**:
- Monitor default token usage via Mapbox dashboard
- Set up billing alerts for unexpected spikes
- Encourage power users to bring their own key
- Default token has URL restriction to `gpx.defcon.run`

**Why hybrid over strict BYOK**:
- Lower friction for casual/first-time users
- Still allows cost ownership for power users
- Graceful experience without blocking on setup

### Decision: Docker Container Strategy

**Single container** (nginx + Next.js):
- Similar to run.human pattern
- nginx serves static assets directly
- Proxies API requests to Next.js
- Self-signed certs for internal TLS

**Dockerfile structure**:
```dockerfile
# Stage 1: Build gpx.studio frontend
FROM node:22-alpine AS gpx-builder
WORKDIR /gpx
COPY gpx-studio/ .
COPY patches/ ./patches/
RUN npm ci && npm run build
# Output: /gpx/website/build/

# Stage 2: Build Next.js backend
FROM node:22-alpine AS app-builder
WORKDIR /app
COPY webapp/ .
COPY --from=gpx-builder /gpx/website/build/ ./public/gpx/
RUN npm ci && npm run build

# Stage 3: Production runtime
FROM node:22-alpine
# ... copy built assets, configure nginx, etc.
```

## Authentication Architecture

### OIDC Client Registration

Add to `apps/run.auth/webapp/src/config/oidc.ts`:

```typescript
{
  client_id: config.oidc.clients.gpxStudio.clientId,
  client_secret: config.oidc.clients.gpxStudio.clientSecret,
  grant_types: ['authorization_code', 'refresh_token'],
  redirect_uris: [
    'https://gpx.defcon.run/use1/api/auth/callback/run.defcon.run',
    'https://gpx.defcon.run/cac1/api/auth/callback/run.defcon.run',
    'http://localhost:3003/use1/api/auth/callback/run.defcon.run', // dev
  ],
  post_logout_redirect_uris: [
    'https://gpx.defcon.run/use1',
    'https://gpx.defcon.run/cac1',
    'http://localhost:3003/use1',
  ],
  scope: 'openid profile email services',
}
```

### Auth.js Configuration

```typescript
// apps/run.gpx/webapp/src/config/auth.ts
export const authConfig = {
  providers: [
    {
      id: 'run.defcon.run',
      name: 'DEF CON',
      type: 'oidc',
      issuer: `https://auth.defcon.run/${region}/api/oidc`,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      authorization: { params: { scope: 'openid profile email services' } },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === 'run.defcon.run') {
        token.services = profile.services ?? [];
      }
      return token;
    },
    async session({ session, token }) {
      session.user.services = token.services;
      return session;
    },
  },
};

// Service claim middleware
export function requireService(service: string) {
  return async (session) => {
    if (!session?.user?.services?.includes(service)) {
      throw new Error(`Access denied: ${service} service required`);
    }
  };
}
```

## Storage Integration

### S3 Client Configuration

```typescript
// apps/run.gpx/webapp/src/lib/s3-client.ts
import { S3Client } from '@aws-sdk/client-s3';

export const s3Client = new S3Client({
  region: process.env.S3_UPLOADS_REGION,
  credentials: {
    accessKeyId: process.env.S3_UPLOADS_ACCESS_KEY!,
    secretAccessKey: process.env.S3_UPLOADS_SECRET_KEY!,
  },
});

export const BUCKET = process.env.S3_UPLOADS_BUCKET!;
export const getUserPrefix = (userId: string) => `uploads/${userId}/gpx/`;
```

### Presigned URL Generation

```typescript
// apps/run.gpx/webapp/src/app/api/gpx/upload/presign/route.ts
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.services?.includes('gpxstudio')) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  const { fileName } = await req.json();
  const fileId = randomUUID();
  const key = `uploads/${session.user.id}/gpx/${fileId}.gpx`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: 'application/gpx+xml',
    Tagging: `owner=${session.user.id}`,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  // Create DynamoDB record
  await createGpxFile(session.user.id, fileId, fileName, key);

  return Response.json({ uploadUrl, fileId });
}
```

## Frontend Modifications

### Storage Layer Abstraction

Replace Dexie calls with API calls:

```typescript
// Modified: website/src/lib/db/api-adapter.ts
class ApiStorageAdapter {
  async listFiles(): Promise<GpxFile[]> {
    const res = await fetch('/api/gpx/files');
    return res.json();
  }

  async saveFile(file: GpxFile, content: string): Promise<void> {
    // Get presigned URL
    const { uploadUrl, fileId } = await fetch('/api/gpx/upload/presign', {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name }),
    }).then(r => r.json());

    // Upload directly to S3
    await fetch(uploadUrl, {
      method: 'PUT',
      body: content,
      headers: { 'Content-Type': 'application/gpx+xml' },
    });

    return fileId;
  }

  async loadFile(fileId: string): Promise<string> {
    const { downloadUrl } = await fetch(`/api/gpx/files/${fileId}`).then(r => r.json());
    return fetch(downloadUrl).then(r => r.text());
  }

  async deleteFile(fileId: string): Promise<void> {
    await fetch(`/api/gpx/files/${fileId}`, { method: 'DELETE' });
  }
}

export const storage = new ApiStorageAdapter();
```

### Auth State Integration

```svelte
<!-- Modified: website/src/routes/+layout.svelte -->
<script>
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';

  onMount(async () => {
    // Fetch session from Next.js backend
    const res = await fetch('/api/auth/session');
    const session = await res.json();

    if (!session?.user) {
      // Redirect to login
      window.location.href = '/api/auth/signin';
      return;
    }

    if (!session.user.services?.includes('gpxstudio')) {
      // Show access denied
      window.location.href = '/access-denied';
      return;
    }

    authStore.set(session);
  });
</script>

{#if $authStore}
  <slot />
{:else}
  <div class="loading">Loading...</div>
{/if}
```

## Infrastructure Configuration

### Terraform Service Definition

```hcl
# infra/terraform/live/site/services/run-gpx/service.hcl

locals {
  service_name = "run-gpx"
  container_name = "gpx-webapp"
}

ecr_repositories = [
  {
    name = "run-gpx-webapp"
    regions = ["us-east-1", "ca-central-1"]
    max_image_count = 10
    expiry_days = 30
    tags_immutable = true
  }
]

ecs_task_definitions = [
  {
    name = "run-gpx-webapp"
    cpu = 512
    memory = 1024
    containers = [
      {
        name = "gpx-webapp"
        image_uri_ref = "run-gpx-webapp"
        essential = true
        cpu = 512
        memory = 1024
        port_mappings = [{ containerPort = 3000 }]
        environment = [
          { name = "NODE_ENV", value = "production" },
          { name = "REGION_SHORT", value = "{{REGION_LABEL}}" },
          { name = "NEXTAUTH_URL", value = "https://gpx.defcon.run/{{REGION_LABEL}}" },
        ]
        secrets = [
          { name = "OIDC_CLIENT_ID", valueFrom = "/dc34/secrets/{{REGION}}/gpxstudio/oidc_client_id" },
          { name = "OIDC_CLIENT_SECRET", valueFrom = "/dc34/secrets/{{REGION}}/gpxstudio/oidc_client_secret" },
          { name = "S3_UPLOADS_ACCESS_KEY", valueFrom = "/dc34/uploads/{{REGION_LABEL}}/run-gpx/access_key_id" },
          { name = "S3_UPLOADS_SECRET_KEY", valueFrom = "/dc34/uploads/{{REGION_LABEL}}/run-gpx/secret_access_key" },
          { name = "S3_UPLOADS_BUCKET", valueFrom = "/dc34/uploads/{{REGION_LABEL}}/run-gpx/bucket_name" },
          { name = "MAPBOX_DEFAULT_TOKEN", valueFrom = "/dc34/secrets/{{REGION}}/gpxstudio/mapbox_default_token" },
        ]
        health_check = {
          command = ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
          interval = 30
          timeout = 5
          retries = 3
          start_period = 60
        }
      }
    ]
  }
]

ecs_services = [
  {
    name = "run-gpx-webapp"
    task_definition_ref = "run-gpx-webapp"
    desired_count = 1
    regions = ["us-east-1"]

    load_balancers = [
      {
        type = "alb"
        container_name = "gpx-webapp"
        container_port = 3000
        listener = {
          port = 443
          protocol = "HTTPS"
          host_headers = ["gpx.defcon.run"]
          path_pattern = "/*"
          priority = 100
        }
        health_check = {
          path = "/api/health"
          healthy_threshold = 2
          unhealthy_threshold = 3
          interval = 30
        }
      }
    ]
  }
]
```

### S3 Bucket Configuration

Add to `site.hcl`:
```hcl
user_uploads = [
  # ... existing uploads ...
  {
    name = "run-gpx"
    service_name = "run-gpx"
    regions = ["us-east-1", "ca-central-1"]

    lifecycle = {
      uploads_expire_days = 0      # Keep GPX files indefinitely
      processed_expire_days = 0
      enable_versioning = true
    }

    replication = {
      enabled = true
      replica_regions = [
        { label = "use1", full = "us-east-1" },
        { label = "cac1", full = "ca-central-1" }
      ]
    }

    full_bucket_access = false     # User-isolated prefix access
    cloudfront_access = false      # Presigned URLs, not direct CDN
  }
]
```

## Infrastructure Requirements for New Services

When adding a new service domain to CloudFront (e.g., `gpx`), these requirements must be met:

### 1. Add Domain to site.hcl

```hcl
cloudfront = {
  domains = ["auth", "run", "cms", "gpx"]  # Add new domain
}

dns = {
  subdomains = ["email", "run", "auth", "cms", "gpx"]  # Add subdomain
}
```

### 2. Regional CloudFront Assets Module

The `cloudfront-assets` module automatically creates S3 buckets for each domain in `cloudfront.domains`. No additional configuration needed - just adding the domain to the list.

### 3. Terragrunt Dependencies with Skipped Regions

When a region is in `skip_regions`, Terragrunt dependencies may return empty values. All secondary region lookups MUST use `try()` wrappers:

```hcl
# In global/cloudfront/terragrunt.hcl
regional_origins_by_domain = {
  for domain in local.site_vars.locals.cloudfront.domains : domain => {
    use1 = {
      # Primary region - direct access OK
      s3_bucket_regional_domain_name = dependency.use1_cloudfront.outputs.bucket_regional_domain_names[domain]
    }
    cac1 = {
      # Secondary region - MUST use try() for graceful fallback
      s3_bucket_regional_domain_name = try(dependency.cac1_cloudfront.outputs.bucket_regional_domain_names[domain], "")
    }
  }
}
```

### 4. CloudFront Module Origin Filtering

The CloudFront module filters origins where `domain_name` is empty. This is handled automatically by the module, but new dynamic blocks iterating over regional origins MUST include filtering:

```hcl
# Filter pattern for dynamic blocks
dynamic "origin" {
  for_each = {
    for region_key, region_value in var.regional_origins_by_domain[each.key] :
    region_key => region_value
    if region_value.s3_bucket_regional_domain_name != ""  # Required filter
  }
  content {
    domain_name = origin.value.s3_bucket_regional_domain_name
    # ...
  }
}
```

### 5. ACM Certificate

Certificates must exist in us-east-1 for CloudFront:
- Add domain to `certs` module configuration
- Certificate ARN is looked up via `cert_map["gpx.defcon.run"]`

### 6. WAF Configuration (Optional)

If WAF protection is needed:
```hcl
cloudfront = {
  waf_rulesets = {
    gpx = "default"  # Use default or api ruleset
  }
}
```

### 7. Checklist for New CloudFront Domains

- [ ] Add to `cloudfront.domains` in site.hcl
- [ ] Add to `dns.subdomains` in site.hcl
- [ ] Add certificate config to us-east-1/certs
- [ ] Verify `try()` wrappers for secondary region dependencies
- [ ] Test with `terragrunt plan` (secondary region in skip_regions)
- [ ] Test with `terragrunt apply` in primary region
- [ ] Verify DNS record creation

## Risks / Trade-offs

### Risk: Upstream gpx.studio updates
- **Mitigation**: Use submodule + minimal patches; review upstream changes monthly
- **Mitigation**: Keep modifications isolated to storage layer abstraction

### Risk: Mapbox API costs
- **Mitigation**: Monitor usage via Mapbox dashboard
- **Mitigation**: Consider caching tiles if usage is high
- **Mitigation**: Set up billing alerts

### Risk: Large GPX files exceeding S3 limits
- **Mitigation**: Presigned URLs support multipart upload
- **Mitigation**: Add file size validation (e.g., 50MB max)
- **Mitigation**: Compress GPX files on save

### Risk: User loses work if S3 unavailable
- **Mitigation**: Implement local draft storage as fallback
- **Mitigation**: Show clear error messages with retry option
- **Mitigation**: S3 cross-region replication for availability

### Trade-off: Dual build system (SvelteKit + Next.js)
- Adds complexity but provides clear separation
- gpx.studio builds independently, then copied to Next.js public/
- Worth it for maintainability and consistency

### Trade-off: No offline support (vs original IndexedDB)
- Original app works fully offline
- Our version requires network for auth and storage
- Acceptable for DEF CON event context
- Could add PWA caching for static assets later

## Environment Variables

**Auth Configuration**:
```
OIDC_CLIENT_ID              # from SSM /dc34/secrets/{region}/gpxstudio/oidc_client_id
OIDC_CLIENT_SECRET          # from SSM /dc34/secrets/{region}/gpxstudio/oidc_client_secret
NEXTAUTH_URL                # https://gpx.defcon.run/{region}
NEXTAUTH_SECRET             # from SSM /dc34/secrets/{region}/gpxstudio/nextauth_secret
```

**S3 Configuration**:
```
S3_UPLOADS_ACCESS_KEY       # from SSM (created by s3-uploads module)
S3_UPLOADS_SECRET_KEY       # from SSM (created by s3-uploads module)
S3_UPLOADS_BUCKET           # from SSM (created by s3-uploads module)
S3_UPLOADS_REGION           # us-east-1 or ca-central-1
```

**Mapbox Configuration**:
```
MAPBOX_DEFAULT_TOKEN        # from SSM /dc34/secrets/{region}/gpxstudio/mapbox_default_token
                            # Fallback token for users without their own
                            # User's AuthProfile.mapboxPublicToken takes precedence if set
```

**App Configuration**:
```
NODE_ENV                    # production
REGION_SHORT                # use1 or cac1
```

## File Structure

```
apps/run.gpx/
├── gpx-studio/             # Git submodule: github.com/gpxstudio/gpx.studio
├── patches/                # Patch files for gpx.studio modifications
│   ├── 001-storage-adapter.patch
│   ├── 002-auth-integration.patch
│   └── 003-branding.patch
├── webapp/                 # Next.js backend application
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   │   ├── gpx/
│   │   │   │   │   ├── files/route.ts
│   │   │   │   │   ├── files/[id]/route.ts
│   │   │   │   │   ├── upload/presign/route.ts
│   │   │   │   │   └── download/presign/route.ts
│   │   │   │   └── health/route.ts
│   │   │   ├── access-denied/page.tsx
│   │   │   └── page.tsx
│   │   ├── config/
│   │   │   └── auth.ts
│   │   ├── entities/
│   │   │   └── gpx-file.ts
│   │   └── lib/
│   │       └── s3-client.ts
│   ├── public/
│   │   └── gpx/            # Built gpx.studio frontend (copied during build)
│   ├── package.json
│   └── next.config.js
├── Dockerfile
├── build.sh
├── VERSION
└── README.md
```

## Open Questions

1. **URL structure**: Should we use regional prefix (`/use1/`) or simple root URL?
   - Recommendation: Simple root URL for better UX

2. **Composition sharing**: Should users be able to share GPX compositions with others?
   - Could add `shared` folder + share links
   - Defer to v2

3. **Import from Strava**: Should we integrate Strava activity import?
   - Users already have Strava connected via auth
   - Could fetch activities directly
   - Defer to v2

4. **Real-time collaboration**: Multiple users editing same composition?
   - Would require WebSocket server and conflict resolution
   - Significant complexity increase
   - Defer to v2

## References

- [gpx.studio GitHub](https://github.com/gpxstudio/gpx.studio)
- [SvelteKit Adapter Static](https://kit.svelte.dev/docs/adapter-static)
- [Auth.js Documentation](https://authjs.dev/)
- [AWS S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
