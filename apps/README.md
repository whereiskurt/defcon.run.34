# Applications

The `apps/` directory contains the four services that make up defcon.run, plus shared build/deploy/release tooling.

## Services

| Service | URL | What It Does |
|---------|-----|--------------|
| **run.human** | run.defcon.run | Main app — registration, event info |
| **run.auth** | auth.defcon.run | OIDC provider — SSO across all services |
| **run.gpx** | gpx.defcon.run | GPX route editor — plan your Vegas runs |
| **run.cms** | cms.defcon.run | Headless CMS — schedules, announcements |

## Request Flow

```
┌────────┐    ┌────────────┐    ┌─────┐    ┌─────────┐    ┌───────────┐
│ Browser│───▶│ CloudFront │───▶│ WAF │───▶│   ALB   │───▶│ECS Fargate│
└────────┘    │  (Edge)    │    │     │    │(Regional)│   │ (Next.js) │
              └────────────┘    └─────┘    └─────────┘    └────┬──────┘
                                                               │
              ┌────────────────────────────────────────────────┘
              ▼
    ┌──────────────────────────────────────────────────────────┐
    │                     Data Layer                           │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
    │  │  DynamoDB   │  │     S3      │  │    SES      │       │
    │  │ (ElectroDB) │  │  (Uploads)  │  │  (Email)    │       │
    │  └─────────────┘  └─────────────┘  └─────────────┘       │
    └──────────────────────────────────────────────────────────┘
```

## Authentication Flow (OIDC)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          User Login Flow                                 │
└──────────────────────────────────────────────────────────────────────────┘

  ┌────────┐         ┌────────────┐         ┌────────────┐
  │  User  │         │ run.human  │         │ run.auth   │
  │Browser │         │ (App)      │         │ (OIDC)     │
  └───┬────┘         └─────┬──────┘         └─────┬──────┘
      │                    │                      │
      │  1. Click Login    │                      │
      │───────────────────▶│                      │
      │                    │  2. Redirect to      │
      │                    │     /authorize       │
      │◀───────────────────│─────────────────────▶│
      │                    │                      │
      │  3. Enter email    │                      │
      │──────────────────────────────────────────▶│
      │                    │                      │
      │                    │     ┌────────────┐   │
      │                    │     │    SES     │   │
      │                    │     │  (Email)   │◀──│ 4. Send magic link
      │                    │     └─────┬──────┘   │
      │  5. Click link     │           │          │
      │◀───────────────────────────────┘          │
      │                    │                      │
      │──────────────────────────────────────────▶│ 6. Verify token
      │                    │                      │
      │◀─────────────────────────────────────────▶│ 7. Issue JWT
      │  8. Redirect with  │                      │
      │     session cookie │                      │
      │───────────────────▶│                      │
      │                    │                      │
      │  9. Authenticated! │                      │
      │◀───────────────────│                      │
```

## Master-Worker CMS Replication

The CMS uses SQLite with [Litestream](https://litestream.io/) for continuous replication:

```
┌──────── Master (us-east-1) ────────┐     ┌──────── Workers ────────┐
│  Strapi → SQLite → Litestream      │────▶│  S3 → SQLite → Strapi   │
│  (writes, continuous WAL sync)     │     │  (reads, 5-min restore) │
└────────────────────────────────────┘     └─────────────────────────┘
```

Admin writes go to master. Litestream streams WAL to S3. Workers periodically restore and atomically swap DBs. Reads fan out via ECS service discovery. Simple, cheap, resilient.

## Embedded Open Source — GPX Editor

The GPX editor embeds [gpx-studio](https://gpx.studio) — an open-source SvelteKit app wrapped in Next.js:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         run.gpx Architecture                             │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Next.js Shell                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Auth.js       │  │   API Routes    │  │   /studio   │  │
│  │   (Session)     │  │   (/api/gpx/*)  │  │  (Static)   │  │
│  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘  │
└───────────┼────────────────────┼──────────────────┼─────────┘
            │                    │                  │
            ▼                    ▼                  ▼
     ┌────────────┐       ┌────────────┐    ┌─────────────────┐
     │  DynamoDB  │       │     S3     │    │   gpx-studio    │
     │ (Metadata) │       │  (Files)   │    │   (SvelteKit)   │
     │ - versions │       │ - .gpx     │    │  Built at deploy│
     │ - shares   │       │ - exports  │    │  Served static  │
     └────────────┘       └────────────┘    └─────────────────┘

Flow: User → Auth → Load GPX list → Open in Studio → Save via API → S3
```

- Next.js handles auth (Auth.js) and API routes
- gpx-studio built at deploy time, served as static files under `/studio/*`
- Cloud storage via presigned S3 URLs + DynamoDB metadata
- Versioning and public/private share links

## Development

```bash
# Dev servers (VS Code tasks auto-start these)
PORT=3001 npm run dev      # run.human (from apps/run.human/webapp)
PORT=3002 npm run dev      # run.auth  (from apps/run.auth/webapp)
PORT=3003 npm run dev      # run.gpx   (from apps/run.gpx/webapp)
PORT=1337 npm run develop  # run.cms   (from apps/run.cms/app)

# GPX needs frontend built first
cd apps/run.gpx && ./build-frontend.sh
```

## E2E Testing

Playwright-based E2E tests cover multi-user auth scenarios and session persistence. See [`run.auth/e2e/`](run.auth/e2e/) for details.

```bash
cd apps && ./e2e.sh --headed
```

## Release

```bash
./release-all.sh --parallel       # Build + deploy all apps, all regions
./build.sh <app>                  # Build and push a single app to ECR
./deploy.sh <app> <region>        # Deploy a single app to a region via Terragrunt
```

## Per-App Docs

- [`run.gpx/README.md`](run.gpx/README.md) — GPX editor architecture and build instructions
