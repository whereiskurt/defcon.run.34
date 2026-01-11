# BRouter Service Implementation Tasks

## Phase 1: Local Development Setup

- [ ] Create `apps/run.brouter/` directory structure
- [ ] Add docker-compose.yml for local BRouter
- [ ] Download segment data for test region (small area)
- [ ] Test BRouter API locally
- [ ] Update gpx-studio to use local BRouter in dev

## Phase 2: Data Preparation

- [ ] Determine region coverage (Las Vegas / Southwest US / Western US)
- [ ] Download required segment files from brouter.de
- [ ] Create S3 bucket for segment storage
- [ ] Upload segments to S3
- [ ] Document segment update process

## Phase 3: Infrastructure (Terraform)

- [ ] Create EFS filesystem for segment storage
- [ ] Create ECS task definition for BRouter
- [ ] Create ECS service with health checks
- [ ] Configure ALB target group (internal)
- [ ] Add service discovery for internal DNS
- [ ] Create data sync mechanism (S3 → EFS)

## Phase 4: gpx-studio Integration

- [ ] Update Next.js proxy to route to internal BRouter
- [ ] Add fallback logic for public BRouter
- [ ] Add error handling and logging
- [ ] Test routing in staging environment

## Phase 5: Deployment

- [ ] Deploy to us-east-1
- [ ] Verify routing works end-to-end
- [ ] Optional: Deploy to ca-central-1
- [ ] Update DNS if public endpoint desired
- [ ] Performance testing with concurrent requests

## Phase 6: Documentation

- [ ] Add operational runbook
- [ ] Document segment update process
- [ ] Add monitoring/alerting configuration
- [ ] Update gpx-studio README

## Dependencies

- gpx-studio service must be deployed first
- EFS requires VPC configuration
- Segment data download may take time (large files)

## Estimates

| Phase | Complexity | Notes |
|-------|------------|-------|
| Phase 1 | Low | Local Docker setup |
| Phase 2 | Low | Download and upload data |
| Phase 3 | Medium | New Terraform modules |
| Phase 4 | Low | Minor code changes |
| Phase 5 | Low | Standard deployment |
| Phase 6 | Low | Documentation |

## Risks

1. **Large data download** - Segment files are big, may take time
2. **Memory requirements** - BRouter needs adequate RAM for large areas
3. **Cold start** - First request after deploy may be slow
4. **Data freshness** - OSM data may be outdated for new roads

## Success Criteria

- [ ] Route requests complete in <2 seconds
- [ ] 99% uptime during DEF CON event
- [ ] No dependency on external brouter.gpx.studio
- [ ] Graceful fallback if self-hosted fails
