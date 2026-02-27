# Change: Add Strapi CMS with Litestream Replication

## Why
The project needs a content management system for event content (pages, announcements, schedules) and media assets without requiring code deployments for content updates. A single-writer/multi-reader architecture with Litestream provides SQLite simplicity with S3-based durability and cross-region read replicas.

## What Changes
- **NEW** Strapi CMS service (`run.cms`) with SQLite database
- **NEW** Litestream sidecar container for continuous S3 replication
- **NEW** Primary instance (us-east-1) handles all writes to `cms.defcon.run`
- **NEW** Worker instances (both regions) serve read-only content with 5-minute sync
- **NEW** S3 bucket for SQLite database replication and media assets
- **NEW** CloudFront routing for `cms.defcon.run` subdomain

## Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │              CloudFront                      │
                    │         cms.defcon.run                       │
                    └────────────┬───────────────┬────────────────┘
                                 │               │
                    ┌────────────▼───┐    ┌──────▼────────────┐
                    │   us-east-1    │    │   ca-central-1    │
                    │   (PRIMARY)    │    │   (REPLICA)       │
                    └────────┬───────┘    └────────┬──────────┘
                             │                     │
              ┌──────────────▼──────────────┐     │
              │      Strapi Master          │     │
              │   (Read/Write - Admin)      │     │
              │  ┌────────┐  ┌───────────┐  │     │
              │  │ Strapi │  │Litestream │  │     │
              │  │  R/W   │──│  (push)   │──┼─────┼──┐
              │  └────────┘  └───────────┘  │     │  │
              └─────────────────────────────┘     │  │
                                                  │  │
              ┌──────────────────────────────┐    │  │
              │       S3 Bucket              │◄───┼──┘
              │  (SQLite + Media Assets)     │    │
              │  dc34-cms-litestream-use1    │────┼──────┐
              └──────────────────────────────┘    │      │
                                                  │      │ (replicate)
              ┌──────────────▼──────────────┐     │      ▼
              │      Strapi Worker          │     │   ┌──────────┐
              │   (Read-Only - use1)        │     │   │ S3 cac1  │
              │  ┌────────┐  ┌───────────┐  │     │   │ (replica)│
              │  │ Strapi │  │Litestream │◄─┼─────┼───└──────────┘
              │  │  R/O   │◄─│  (pull)   │  │     │
              │  └────────┘  └───────────┘  │     │
              └─────────────────────────────┘     │
                                                  │
              ┌───────────────────────────────────▼─┐
              │      Strapi Worker                  │
              │   (Read-Only - cac1)                │
              │  ┌────────┐  ┌───────────┐          │
              │  │ Strapi │  │Litestream │◄─────────┤
              │  │  R/O   │◄─│  (pull)   │          │
              │  └────────┘  └───────────┘          │
              └────────────────────────────────────┘
```

## Impact
- **Affected specs**: None (new capability)
- **Affected code**:
  - `apps/run.cms/` - New Strapi application
  - `infra/terraform/live/site/services/cms/service.hcl` - New service definition
  - `infra/terraform/live/site/site.hcl` - Add CMS to aggregations
- **Existing modules used**:
  - `modules/ecr` - Container registries
  - `modules/ecs-task` - Task definitions
  - `modules/ecs-service` - ECS services with ALB
  - `modules/s3-uploads` - Litestream + media buckets
  - `modules/cloudfront` - CDN routing for cms.defcon.run
  - `modules/secrets` - SSM parameters for Strapi secrets
- **Infrastructure**: New ECS tasks, S3 buckets, SSM secrets
- **Cost estimate**: ~$50-100/month (2 Fargate tasks + S3 storage)
