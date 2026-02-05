# Infrastructure

Terragrunt + Terraform modules powering multi-region AWS infrastructure for defcon.run.

## Directory Structure

```
infra/terraform/
├── live/site/                      # Terragrunt live configuration
│   ├── terragrunt.hcl              # Root config (provider, backend)
│   ├── site.hcl                    # Site-wide variables
│   ├── SECRETS.md                  # Secrets management guide
│   ├── global/                     # Global resources (CloudFront, ECR, etc.)
│   ├── region/                     # Per-region resources
│   │   ├── us-east-1/              # Virginia (primary)
│   │   └── ca-central-1/           # Canada
│   └── services/                   # Per-service Terragrunt definitions
│       ├── run.auth/               # run.auth ECS service
│       ├── run.cms/                # run.cms ECS service
│       ├── run.gpx/                # run.gpx ECS service
│       └── run.human/              # run.human ECS service
└── modules/                        # Reusable Terraform modules
    ├── certs/
    ├── cloudfront/
    ├── cloudfront-assets/
    ├── cloudtrail/
    ├── dynamodb/
    ├── ec2spot/
    ├── ecr/
    ├── ecs-cluster/
    ├── ecs-service/
    ├── ecs-task/
    ├── email/
    ├── github-oidc/
    ├── lambda-edge/
    ├── network/
    ├── s3-uploads/
    ├── s3-uploads-processor/
    ├── secrets/
    └── site/
```

## Deployment Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (OIDC Federation)                     │
│                    No long-lived AWS credentials                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
    │   Build     │          │   Build     │          │   Build     │
    │  run.auth   │          │  run.human  │          │   run.gpx   │
    └──────┬──────┘          └──────┬──────┘          └──────┬──────┘
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │     Push to ECR     │
                         │  (Container Images) │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼                               ▼
           ┌────────────────┐              ┌────────────────┐
           │  Deploy ECS    │              │  Deploy ECS    │
           │  us-east-1     │              │ ap-southeast-1 │
           │  (Terragrunt)  │              │  (Terragrunt)  │
           └────────────────┘              └────────────────┘
```

## Multi-Region Active-Active

Both regions run identical services. CloudFront routes by path prefix (`/use1/*`, `/apse1/*`). Apps use dynamic `basePath`. DynamoDB global tables replicate across regions. One `release-all.sh --parallel` and you're live everywhere.

### Adding a New Region

```
1. Create regional config:     infra/terraform/live/site/region/ap-southeast-1/
2. Add service definitions:    infra/terraform/live/site/services/*/apse1.hcl
3. Update CloudFront origins:  Add /apse1/* path routing
4. Extend DynamoDB tables:     Add region to global table replicas
5. Deploy:                     ./apps/release-all.sh --parallel

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  us-east-1   │    │ap-southeast-1│    │  eu-west-1   │
│  (Primary)   │◀──▶│  (Asia)      │◀──▶│  (Europe)    │
│              │    │              │    │   (Future)   │
└──────────────┘    └──────────────┘    └──────────────┘
       ▲                   ▲                   ▲
       └───────────────────┴───────────────────┘
                  DynamoDB Global Tables
```

## Secrets Management

See [`live/site/SECRETS.md`](terraform/live/site/SECRETS.md) for the full guide on SOPS-encrypted secrets, KMS keys, and per-environment configuration.

## Key Commands

```bash
# Plan all infrastructure changes
cd infra/terraform/live/site && terragrunt plan --all

# Apply a specific module
cd infra/terraform/live/site/region/us-east-1/<module> && terragrunt apply

# Validate configuration
cd infra/terraform/live/site && terragrunt validate --all
```

## Module Docs

- [`modules/cloudtrail/README.md`](terraform/modules/cloudtrail/README.md)
- [`modules/ecr/README.md`](terraform/modules/ecr/README.md)
