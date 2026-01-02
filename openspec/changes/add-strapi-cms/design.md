# Design: Strapi CMS with Litestream Replication

## Context
defcon.run 34 needs a CMS for managing event content (pages, announcements, schedules) and media assets. The existing architecture uses multi-region ECS Fargate with DynamoDB global tables, but Strapi requires a relational database. Rather than introducing RDS complexity, we use SQLite with Litestream for S3-based replication.

### Stakeholders
- Content editors (defcon.run staff) - need reliable admin interface
- Participants - consume content via run.human app
- Infrastructure - minimal operational overhead

### Constraints
- ECS Fargate: No persistent volumes, ephemeral storage only
- Multi-region: Content must be accessible from both us-east-1 and ca-central-1
- **Must use existing Terraform modules**: `s3-uploads`, `cloudfront`, `cloudfront-assets`, `ecs-task`, `ecs-service`, `ecr`, `secrets`
- **Follow service.hcl pattern**: Define all resources in `infra/terraform/live/site/services/cms/service.hcl`
- **Integrate with site.hcl**: Add CMS service to existing aggregation pattern

## Goals / Non-Goals

### Goals
- Single source of truth for content editing (master in us-east-1)
- Read-only replicas in both regions for low-latency content delivery
- Automatic database replication via Litestream to S3
- Media asset storage in S3 with CloudFront delivery
- Admin panel accessible at `cms.defcon.run`
- **Reuse existing infrastructure modules and patterns**

### Non-Goals
- Real-time sync (5-minute delay acceptable for content)
- Multi-master writes (single writer simplifies consistency)
- Complex RBAC (basic Strapi roles sufficient)
- Custom Strapi plugins (use built-in features)
- Creating new Terraform modules (use existing ones)

## Decisions

### Decision 1: SQLite + Litestream over RDS
**Choice**: SQLite with Litestream S3 replication

**Alternatives considered**:
| Option | Pros | Cons |
|--------|------|------|
| RDS Aurora | Managed, multi-region | Complex, expensive (~$100+/mo), overkill for CMS |
| DynamoDB | Existing pattern | Strapi doesn't support it natively |
| SQLite + EFS | Persistent storage | EFS not available on Fargate |
| **SQLite + Litestream** | Simple, cheap, proven | Single-writer only |

**Rationale**: Litestream provides continuous replication to S3 with sub-second RPO. Workers pull snapshots every 5 minutes. This matches our content update frequency needs.

### Decision 2: Master/Worker Architecture
**Choice**: Single master (us-east-1), multiple read-only workers

**Architecture**:
- **Master** (us-east-1 only):
  - Handles all admin/write operations
  - Litestream pushes changes to S3 continuously
  - Runs single replica (no autoscaling)

- **Workers** (us-east-1 + ca-central-1):
  - Serve read-only API requests
  - Litestream pulls from S3 every 5 minutes
  - Can autoscale based on demand

**Traffic routing**:
- `cms.defcon.run/admin/*` → Master only (via ALB path routing)
- `cms.defcon.run/api/*` → Workers (latency-based routing)

### Decision 3: Leverage Existing Modules

**Infrastructure reuse strategy**:

| Resource | Existing Module | How to Use |
|----------|-----------------|------------|
| ECR repos | `modules/ecr` | Add to `ecr_repositories` in service.hcl |
| ECS tasks | `modules/ecs-task` | Define master + worker tasks in service.hcl |
| ECS services | `modules/ecs-service` | Define services with ALB routing in service.hcl |
| Litestream S3 | `modules/s3-uploads` | Add `cms_litestream` to `user_uploads` config |
| Media S3 | `modules/s3-uploads` | Add `cms_media` to `user_uploads` config |
| CloudFront | `modules/cloudfront` | Add `cms` to `cloudfront.domains` in site.hcl |
| CloudFront assets | `modules/cloudfront-assets` | Reuse for static assets if needed |
| Secrets | `modules/secrets` | Add `strapi` section to `secrets.definitions` |

### Decision 4: Service.hcl Structure

Following existing patterns from `run-human/service.hcl` and `auth/service.hcl`:

```hcl
# infra/terraform/live/site/services/cms/service.hcl
locals {
  versions = {
    nginx  = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    webapp = trimspace(file("${get_terragrunt_dir()}/VERSION.webapp"))
  }

  # ECR repositories - follows existing nginx/webapp pattern
  ecr_repositories = [
    {
      name                 = "cms-nginx"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy     = { max_image_count = 10, expire_days = 30 }
    },
    {
      name                 = "cms-webapp"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy     = { max_image_count = 10, expire_days = 30 }
    }
  ]

  # Two task definitions: master (us-east-1 only) and worker (both regions)
  tasks = [
    { name = "cms-master", regions = ["us-east-1"], ... },
    { name = "cms-worker", regions = ["us-east-1", "ca-central-1"], ... }
  ]

  # S3 buckets via user_uploads pattern
  cms_storage = [
    {
      name         = "cms-litestream"
      service_name = "cms"
      regions      = ["us-east-1"]  # Single region for Litestream source
      lifecycle    = { uploads_expire_days = 0, enable_versioning = true }
      replication  = { enabled = false }  # Workers pull directly
    },
    {
      name         = "cms-media"
      service_name = "cms"
      regions      = ["us-east-1", "ca-central-1"]
      lifecycle    = { uploads_expire_days = 0, enable_versioning = true }
      replication  = { enabled = true, replica_regions = [...] }
    }
  ]
}
```

### Decision 5: Site.hcl Integration

Update `site.hcl` to include CMS service following existing aggregation pattern:

```hcl
locals {
  # Add to existing service loads
  ecs_cms_service = read_terragrunt_config("./services/cms/service.hcl")

  # Add "cms" to cloudfront.domains
  cloudfront = {
    domains = ["auth", "run", "cms"]  # Add cms
    # ...
  }

  # Add to ECR aggregation
  ecr = {
    repositories = concat(
      local.ecs_auth_service.locals.ecr_repositories,
      local.ecs_run_human_service.locals.ecr_repositories,
      local.ecs_cms_service.locals.ecr_repositories  # Add
    )
  }

  # Add to user_uploads aggregation
  user_uploads = {
    buckets = concat(
      try(local.ecs_run_human_service.locals.user_uploads, []),
      try(local.ecs_cms_service.locals.cms_storage, [])  # Add
    )
  }

  # Add strapi secrets to definitions
  secrets = {
    definitions = {
      # ... existing ...
      strapi = {
        description = "Strapi CMS secrets"
        keys        = ["admin_jwt_secret", "api_token_salt", "app_keys", "transfer_token_salt"]
      }
    }
  }
}
```

### Decision 6: Container Architecture
**Choice**: nginx + webapp pattern (matching auth/run-human services)

```
ECS Task (matches auth/run-human pattern)
├── cms-nginx (TLS termination, reverse proxy)
│   ├── Port 443 (HTTPS)
│   └── Proxies to webapp:1337
└── cms-webapp (supervisord manages both processes)
    ├── Port 1337 (Strapi HTTP)
    ├── supervisord
    │   ├── strapi (Node.js process)
    │   └── litestream (replicate or restore+sync)
    └── SQLite at /data/strapi.db
```

**Why supervisord**: Both Strapi and Litestream need to run continuously in the same container. Supervisord provides:
- Process management and automatic restart on failure
- Unified logging to stdout/stderr for CloudWatch
- Clean shutdown handling (graceful Litestream sync before exit)
- Single container simplifies ECS task definition and shared volume access

**ECR repositories** (two images, matching existing pattern):
- `cms-nginx` - TLS termination container
- `cms-webapp` - Strapi + Litestream with supervisord

### Decision 7: Media Asset Storage
**Choice**: S3 with Strapi upload provider, using `s3-uploads` module

**Configuration**:
- Strapi `@strapi/provider-upload-aws-s3` plugin
- Media bucket created via `s3-uploads` module: `uploads-dc34-cms-media-{region}-{suffix}`
- S3 replication between regions (built into `s3-uploads` module)
- CloudFront serves media via `cms.defcon.run/uploads/*`

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Master failure | Content edits unavailable | Manual failover procedure; workers continue serving |
| S3 replication lag | Stale content on workers | 5-min sync acceptable; can reduce if needed |
| SQLite corruption | Data loss | Litestream WAL provides point-in-time recovery |
| Cold start latency | Slow worker startup | Pre-warm via Litestream restore; ~30s for small DB |

## Migration Plan

### Phase 1: Infrastructure (Terraform)
1. Create `services/cms/service.hcl` with ECR, tasks, services, storage definitions
2. Update `site.hcl` to aggregate CMS resources
3. Add `cms` to `cloudfront.domains` and `dns.subdomains`
4. Add `strapi` secrets to `.secrets.sops.json`
5. Run `terragrunt run-all apply`

### Phase 2: Application
1. Scaffold Strapi application in `apps/run.cms/strapi/`
2. Configure SQLite database and S3 upload provider
3. Create Dockerfiles following existing `apps/build.sh` pattern
4. Add VERSION files for both images

### Phase 3: Deployment
1. Build and push images using `./apps/build.sh strapi run.cms`
2. Deploy master to us-east-1
3. Verify Litestream replication to S3
4. Deploy workers to both regions
5. Verify CloudFront routing

### Rollback
- Workers: Simply scale down, no data impact
- Master: Point workers to last known good S3 snapshot
- Full rollback: Delete ECS services, retain S3 data for recovery

## Open Questions

1. **Strapi version**: Use Strapi v4 (stable) or v5 (newer)?
   - Recommendation: v4 for stability

2. **Content types**: What specific content types are needed initially?
   - Minimum: Pages, Announcements, Events
   - Can add more via Strapi content-type builder

## Appendix: OIDC Authentication

### Integration with auth.defcon.run

Strapi admin authentication uses the existing OIDC provider at auth.defcon.run. Users must have `cms` in their `services` claim to access the admin panel.

**OIDC Flow**:
1. User visits `cms.defcon.run/admin`
2. Strapi redirects to `auth.defcon.run/oidc/auth?client_id=...&redirect_uri=...`
3. User authenticates via GitHub/Strava/Discord/email
4. auth.defcon.run returns ID token with claims including `services: ["cms", ...]`
5. Strapi validates `cms` is in `services` claim
6. User granted admin access (or denied if no `cms` claim)

**Strapi SSO Plugin Configuration**:
```javascript
// config/plugins.js
module.exports = ({ env }) => ({
  'users-permissions': {
    config: {
      providers: {
        oidc: {
          enabled: true,
          icon: 'shield',
          key: env('STRAPI_OIDC_CLIENT_ID'),
          secret: env('STRAPI_OIDC_CLIENT_SECRET'),
          callback: '/admin/connect/oidc/callback',
          scope: ['openid', 'profile', 'email'],
          authorization_url: 'https://auth.defcon.run/oidc/auth',
          token_url: 'https://auth.defcon.run/oidc/token',
          userinfo_url: 'https://auth.defcon.run/oidc/me',
        },
      },
    },
  },
});
```

**Services Claim Validation** (custom middleware):
```javascript
// src/middlewares/oidc-services-check.js
module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    if (ctx.state.user?.services) {
      if (!ctx.state.user.services.includes('cms')) {
        return ctx.forbidden('User does not have CMS access');
      }
    }
    await next();
  };
};
```

## Appendix: Secrets Workflow

### Creating/Updating Secrets

Secrets are managed via plaintext `.secrets.json` and encrypted with SOPS:

```bash
# 1. Edit plaintext secrets
vi infra/terraform/live/site/.secrets.json

# 2. Encrypt with SOPS
sops --encrypt .secrets.json > .secrets.sops.json

# 3. Commit only the encrypted file
git add .secrets.sops.json
git commit -m "Update secrets"
```

### Strapi Secrets Structure

Add to `.secrets.json`:
```json
{
  "strapi": {
    "admin_jwt_secret": "<generated-secret>",
    "api_token_salt": "<generated-secret>",
    "app_keys": "<key1>,<key2>",
    "transfer_token_salt": "<generated-secret>",
    "oidc_client_id": "<client-id-for-cms>",
    "oidc_client_secret": "<client-secret-for-cms>"
  }
}
```

### SSM Parameter Paths

The secrets module creates SSM parameters at:
- `/dc34/secrets/use1/strapi/admin_jwt_secret`
- `/dc34/secrets/use1/strapi/api_token_salt`
- `/dc34/secrets/use1/strapi/app_keys`
- `/dc34/secrets/use1/strapi/transfer_token_salt`
- `/dc34/secrets/use1/strapi/oidc_client_id`
- `/dc34/secrets/use1/strapi/oidc_client_secret`
- (same for `cac1` region)

### Generating Secrets

```bash
# Generate random secrets
openssl rand -base64 32  # admin_jwt_secret
openssl rand -base64 32  # api_token_salt
openssl rand -base64 32  # transfer_token_salt
# app_keys needs two comma-separated values
echo "$(openssl rand -base64 32),$(openssl rand -base64 32)"
```

### OIDC Client Registration

Register the CMS as an OIDC client in auth.defcon.run:
1. Add client to oidc-provider configuration
2. Set redirect_uri: `https://cms.defcon.run/admin/connect/oidc/callback`
3. Generate client_id and client_secret
4. Add to `.secrets.json` under `strapi.oidc_client_id` and `strapi.oidc_client_secret`

## Appendix: Litestream Configuration

### Master (replicate mode)
```yaml
# /etc/litestream/litestream.yml
dbs:
  - path: /data/strapi.db
    replicas:
      - type: s3
        bucket: uploads-dc34-cms-litestream-use1-${BUCKET_SUFFIX}
        path: db
        region: us-east-1
        sync-interval: 1s
```

### Worker (restore + sync mode)
```yaml
# /etc/litestream/litestream.yml
dbs:
  - path: /data/strapi.db
    replicas:
      - type: s3
        bucket: uploads-dc34-cms-litestream-use1-${BUCKET_SUFFIX}
        path: db
        region: us-east-1
```

## Appendix: Supervisord Configuration

Both Strapi and Litestream run under supervisord in the webapp container.

### Master supervisord.conf
```ini
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0

[program:litestream]
command=/usr/bin/litestream replicate -config /etc/litestream/litestream.yml
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=100

[program:strapi]
command=node /app/node_modules/.bin/strapi start
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=200
```

### Worker supervisord.conf
```ini
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0

[program:litestream-restore]
command=/usr/local/bin/litestream-sync.sh
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=100

[program:strapi]
command=node /app/node_modules/.bin/strapi start
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=200
startsecs=10
```

### Worker sync script (litestream-sync.sh)
```bash
#!/bin/sh
# Initial restore from S3
echo "Restoring database from S3..."
litestream restore -config /etc/litestream/litestream.yml -if-db-not-exists /data/strapi.db

# Periodic sync every 5 minutes
while true; do
  sleep 300
  echo "Syncing database from S3..."
  litestream restore -config /etc/litestream/litestream.yml -if-replica-newer /data/strapi.db
done
```

## Appendix: Regional Path Routing for Admin Panel

### The Challenge

The multi-region architecture uses path prefixes (`/use1/*`, `/cac1/*`) to route requests to the correct region. However, Strapi's admin panel was not designed for path-prefixed deployments. This requires careful coordination between:

1. **Strapi config** (`admin.url`) - where admin HTML is served
2. **Vite config** (`base`) - where admin static assets load from
3. **Build-time env** (`STRAPI_ADMIN_BACKEND_URL`) - where admin JS makes API calls
4. **nginx** - rewriting paths between frontend expectations and backend reality
5. **ALB listener rules** - which paths route to the CMS service

### Key Insight: Strapi's Split Personality

Strapi's `admin.url` setting **only affects where the admin HTML is served**, NOT the API endpoints:

| Component | Path Without Prefix | Path With `admin.url=/use1/admin` |
|-----------|---------------------|-----------------------------------|
| Admin HTML | `/admin` | `/use1/admin` ✓ |
| Admin Assets | `/admin/*.js` | Unchanged (needs Vite `base`) |
| Admin API | `/admin/init`, `/admin/login` | **Unchanged** (`/admin/*`) |
| Content Manager API | `/content-manager/*` | **Unchanged** |
| Upload API | `/upload/*` | **Unchanged** |

### Solution: Three-Part Configuration

#### 1. Strapi Build Configuration

```dockerfile
# Dockerfile.app - build stage
ARG REGION_SHORT=use1

# Tell admin JS where to make API calls (baked into bundle)
ENV STRAPI_ADMIN_BACKEND_URL=https://cms.defcon.run/${REGION_SHORT}

# Set Vite base path for static assets
ENV REGION_SHORT=${REGION_SHORT}

RUN npm run build
```

```typescript
// src/admin/vite.config.ts
export default (config: UserConfig): UserConfig => {
  const regionShort = process.env.REGION_SHORT || '';
  const basePath = regionShort ? `/${regionShort}/admin/` : '/admin/';
  return mergeConfig(config, { base: basePath });
};
```

```typescript
// config/admin.ts
export default ({ env }) => ({
  url: `/${env('REGION_SHORT', 'use1')}/admin`,
  // ... other config
});
```

#### 2. nginx Path Rewriting

nginx must handle three cases differently:

```nginx
# Case 1: Admin SPA navigation (browser requests HTML)
# Pass through - Strapi serves HTML at /use1/admin
location ~ ^/(use1|cac1)/admin(/.*)?$ {
  set $do_rewrite 0;

  # API calls need prefix stripped
  if ($request_method != GET) { set $do_rewrite 1; }
  if ($http_accept ~* "application/json") { set $do_rewrite 1; }

  if ($do_rewrite = 1) {
    rewrite ^/(use1|cac1)/admin(.*)$ /admin$2 break;
  }

  proxy_pass http://strapi_app;
}

# Case 2: SSO plugin (always strip prefix)
location ~ ^/(use1|cac1)/strapi-plugin-sso(/.*)?$ {
  rewrite ^/(use1|cac1)/strapi-plugin-sso(.*)$ /strapi-plugin-sso$2 break;
  proxy_pass http://strapi_app;
}

# Case 3: All other API routes (always strip prefix)
# Handles: /use1/content-manager/*, /use1/upload/*, /use1/api/*, etc.
location ~ ^/(use1|cac1)(/.*)?$ {
  rewrite ^/(use1|cac1)(.*)$ $2 break;
  proxy_pass http://strapi_app;
}
```

**Why the complexity for admin routes?**
- GET `/use1/admin` with `Accept: text/html` → Browser navigation, serve SPA HTML
- GET `/use1/admin/init` with `Accept: application/json` → API call, strip prefix
- POST `/use1/admin/login` → API call, strip prefix

#### 3. ALB Listener Rules

**Critical**: The ALB must route ALL paths the admin panel needs, not just `/admin*`:

```hcl
# service.hcl - WRONG (missing content-manager, upload, etc.)
path_patterns = ["/{{REGION_LABEL}}/admin*", "/{{REGION_LABEL}}/strapi-plugin-sso/*"]

# CORRECT - catch all regional traffic for CMS
path_patterns = ["/{{REGION_LABEL}}/*"]
```

The admin panel makes API calls to:
- `/use1/admin/*` - admin API
- `/use1/content-manager/*` - content management
- `/use1/upload/*` - media uploads
- `/use1/i18n/*` - internationalization
- And more...

### Request Flow Summary

```
Browser: GET https://cms.defcon.run/use1/admin
    ↓
CloudFront: /use1/* → ALB (us-east-1)
    ↓
ALB: /use1/* → CMS master task
    ↓
nginx: GET /use1/admin, Accept: text/html → pass through
    ↓
Strapi: Serves admin HTML (admin.url=/use1/admin)
    ↓
Browser: Loads /use1/admin/strapi-xxx.js (Vite base=/use1/admin/)
    ↓
Admin JS: GET https://cms.defcon.run/use1/admin/init (STRAPI_ADMIN_BACKEND_URL)
    ↓
CloudFront → ALB → nginx: Accept: application/json → rewrite to /admin/init
    ↓
Strapi: Returns API response from /admin/init
```

### Common Pitfalls

1. **Forgetting `STRAPI_ADMIN_BACKEND_URL`**: Admin JS makes calls to `/admin/*` without region prefix
2. **Incomplete ALB rules**: `/content-manager/*` and `/upload/*` requests get 404
3. **Rewriting SPA routes**: Browser navigation to `/use1/admin/settings` returns JSON 404
4. **nginx location order**: Regex locations match in config order, not specificity
5. **Secure cookie errors**: Session middleware throws "Cannot send secure cookie over unencrypted connection"

### Session Configuration for Reverse Proxy

When TLS terminates at CloudFront/ALB (not at Strapi), the session middleware sees HTTP connections and refuses to set secure cookies. This breaks OIDC SSO which stores state in session cookies.

**Error:**
```
Error: Cannot send secure cookie over unencrypted connection
at Cookies.set (/app/node_modules/cookies/index.js:126:11)
at ContextSession.save (/app/node_modules/koa-session/lib/context.js:341:22)
```

**Solution:** Configure session middleware to allow cookies over "insecure" internal connections:

```typescript
// config/middlewares.ts
{
  name: 'strapi::session',
  config: {
    // TLS terminates at CloudFront/ALB, not at Strapi
    // Cookie is still sent over HTTPS to the browser
    secure: false,
    sameSite: 'lax',
  },
},
```

**Why this is safe:**
- Browser ↔ CloudFront: HTTPS (secure)
- CloudFront ↔ ALB: HTTPS (secure)
- ALB ↔ nginx: HTTPS (self-signed cert)
- nginx ↔ Strapi: HTTP (localhost within container)

The cookie's `secure` flag only affects the internal nginx→Strapi hop. The browser still receives the cookie over HTTPS.

**Note:** Setting `proxy: true` in `server.ts` is NOT sufficient. The session middleware has its own `secure` default that must be explicitly overridden.

## Appendix: Directory Structure

```
apps/run.cms/
├── nginx/                    # TLS termination (matches auth/run-human)
│   ├── Dockerfile
│   └── nginx.conf
├── webapp/                   # Strapi + Litestream via supervisord
│   ├── Dockerfile
│   ├── package.json
│   ├── supervisord.master.conf
│   ├── supervisord.worker.conf
│   ├── litestream.master.yml
│   ├── litestream.worker.yml
│   ├── litestream-sync.sh    # Worker sync script
│   ├── config/
│   │   ├── database.js       # SQLite config
│   │   ├── plugins.js        # S3 upload, OIDC provider
│   │   ├── server.js
│   │   └── middlewares.js    # CORS, services check
│   └── src/
│       ├── api/              # Content types
│       └── middlewares/
│           └── oidc-services-check.js
├── VERSION.nginx
└── VERSION.webapp

infra/terraform/live/site/
├── services/
│   ├── auth/service.hcl
│   ├── run-human/service.hcl
│   └── cms/                  # NEW
│       ├── service.hcl
│       ├── VERSION.nginx
│       └── VERSION.webapp
└── site.hcl                  # Updated to include CMS
```
