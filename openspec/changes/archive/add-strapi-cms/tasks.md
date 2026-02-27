# Tasks: Add Strapi CMS with Litestream Replication

## Critical: AMD64 Build Requirements

Strapi uses `better-sqlite3` which has native C++ bindings. When building on M1/M2 Macs for ECS (linux/amd64):

1. **`.dockerignore`** MUST exclude `node_modules/` to prevent ARM binaries from being copied into build context
2. **Dockerfile** uses `FROM --platform=linux/amd64` to ensure correct base image variant
3. **build.sh** uses `docker buildx build --platform=linux/amd64 --no-cache`
4. The `--no-cache` flag prevents Docker from reusing cached layers with wrong architecture

Without these, the native `better-sqlite3.node` binary will be ARM and fail on ECS with:
```
Error: Error loading shared library .../better_sqlite3.node: Exec format error
```

## 1. Service Definition (service.hcl)
- [x] 1.1 Create `infra/terraform/live/site/services/cms/` directory
- [x] 1.2 Create `service.hcl` with ECR repository definitions (cms-nginx, cms-app)
- [x] 1.3 Define master task in service.hcl (nginx + app with supervisord running strapi + litestream replicate)
- [x] 1.4 Define worker task in service.hcl (nginx + app with supervisord running strapi + litestream restore/sync)
- [x] 1.5 Define `cms_storage` for S3 buckets (litestream + media) using `user_uploads` pattern
- [x] 1.6 Define master service (us-east-1, desired_count=1, no autoscaling)
- [x] 1.7 Define worker service (both regions, autoscaling enabled)
- [x] 1.8 Add VERSION.nginx and VERSION.app files

## 2. Site.hcl Integration
- [x] 2.1 Add `ecs_cms_service = read_terragrunt_config("./services/cms/service.hcl")` to site.hcl
- [x] 2.2 Add `"cms"` to `cloudfront.domains` list
- [x] 2.3 Add `"cms"` to `dns.subdomains` list
- [x] 2.4 Add CMS ECR repositories to `ecr.repositories` concat
- [x] 2.5 Add CMS tasks to `ecs_tasks.tasks` concat
- [x] 2.6 Add CMS services to `ecs_services.services` concat
- [x] 2.7 Add CMS storage to `user_uploads.buckets` concat (with `full_bucket_access` for litestream)
- [x] 2.8 Add `strapi` to `secrets.definitions` with keys: admin_jwt_secret, api_token_salt, app_keys, transfer_token_salt, oidc_client_id, oidc_client_secret

## 3. Secrets & OIDC Configuration
- [x] 3.1 Generate Strapi secrets (`openssl rand -base64 32` for each)
- [x] 3.2 Register CMS as OIDC client in auth.defcon.run oidc-provider config
- [x] 3.3 Generate oidc_client_id and oidc_client_secret for CMS client
- [x] 3.4 Add all strapi secrets to `.secrets.json`:
  - admin_jwt_secret, api_token_salt, app_keys, transfer_token_salt
  - oidc_client_id, oidc_client_secret
- [x] 3.5 Encrypt with `sops --encrypt .secrets.json > .secrets.sops.json`
- [x] 3.6 Verify secrets module will create SSM parameters at `/dc34/secrets/{region}/strapi/*`

## 4. Terraform Apply
- [x] 4.1 Run `terragrunt run-all plan` to verify configuration
- [x] 4.2 Verify ECR repositories will be created via `modules/ecr`
- [x] 4.3 Verify S3 buckets will be created via `modules/s3-uploads`
- [x] 4.4 Verify CloudFront will include cms.defcon.run via `modules/cloudfront`
- [x] 4.5 Verify ACM certificate will be requested for cms.defcon.run
- [x] 4.6 Run `terragrunt run-all apply` to create infrastructure
- [x] 4.7 Updated s3-uploads module with `full_bucket_access` option for Litestream IAM policy
- [x] 4.8 CloudFront OAC bucket policy with `AWS:SourceArn` for CMS media

## 5. Application - Strapi Setup
- [x] 5.1 Create `apps/run.cms/` directory structure
- [x] 5.2 Initialize Strapi project with package.json and dependencies
- [x] 5.3 Configure SQLite database in `config/database.js`
- [x] 5.4 Install `@strapi/provider-upload-aws-s3` and configure in `config/plugins.js`
- [x] 5.5 Configure OIDC SSO provider in `config/plugins.js` (auth.defcon.run endpoints)
- [x] 5.6 Create services claim validation middleware (`src/middlewares/oidc-services-check.js`)
- [x] 5.7 Configure server settings in `config/server.js` (port 1337, host 0.0.0.0)
- [ ] 5.8 Create initial content types: Page, Announcement, Event (via admin panel after deployment)
- [x] 5.9 Configure CORS for defcon.run domains in `config/middlewares.js`
- [x] 5.10 Create health check endpoint (`/_health`) for load balancer
- [x] 5.11 Configure S3 `rootPath` for region-prefixed uploads (`{region}/cms/`)

## 6. Application - Docker Images
- [x] 6.1 Create `apps/run.cms/nginx/Dockerfile.nginx` (proxy to port 1337)
- [x] 6.2 Create `apps/run.cms/nginx/nginx.conf` (TLS termination, proxy to strapi:1337)
- [x] 6.3 Create `apps/run.cms/app/Dockerfile.app` (Node.js + Strapi + Litestream + supervisord)
- [x] 6.4 Create `supervisord.master.conf` (runs litestream replicate + strapi)
- [x] 6.5 Create `supervisord.worker.conf` (runs litestream-sync.sh + strapi)
- [x] 6.6 Create `litestream.master.yml` (replicate mode, sync-interval=1s)
- [x] 6.7 Create `litestream.worker.yml` (restore mode)
- [x] 6.8 Create `litestream-sync.sh` (initial restore + 5-min sync loop)
- [x] 6.9 Create `apps/run.cms/nginx/VERSION` and `apps/run.cms/app/VERSION`

## 7. Build Scripts
- [x] 7.1 Modify `apps/build.sh` to support run.cms with 'app' component
- [x] 7.2 Add `.dockerignore` to exclude `node_modules/` (prevents ARM binaries in build context)
- [x] 7.3 Add `--no-cache` to build.sh for CMS app (forces fresh native module compilation)
- [x] 7.4 Add `--platform=linux/amd64` to Dockerfile FROM statements
- [x] 7.5 Update `release-all.sh` to support run.cms with correct component mapping
- [x] 7.6 Update `deploy.sh` for Terragrunt v0.96 syntax (`run apply --all`)
- [ ] 7.7 Test `./apps/build.sh nginx run.cms` builds successfully
- [ ] 7.8 Test `./apps/build.sh app run.cms` builds successfully
- [ ] 7.9 Build and push nginx image to ECR
- [ ] 7.10 Build and push app image to ECR

## 8. Deployment - Master
- [ ] 8.1 Update VERSION files to trigger ECS deployment
- [ ] 8.2 Run `./apps/deploy.sh run.cms use1` to deploy master
- [ ] 8.3 Verify Strapi admin panel redirects to auth.defcon.run for OIDC login
- [ ] 8.4 Verify user with `services: ["cms"]` claim can access admin
- [ ] 8.5 Verify user without `cms` service claim is denied access
- [ ] 8.6 Verify Litestream is replicating to S3 bucket

## 9. Deployment - Workers

### Worker Startup Flow
Workers get their database from the master's Litestream S3 bucket on first startup:
1. **supervisord** starts `litestream-sync.sh` (priority 100) and `strapi` (priority 200)
2. **litestream-sync.sh** removes `/data/.db-ready` flag, runs `litestream restore` from S3
3. If no database exists in S3 (first-ever deploy), creates empty `/data/strapi.db`
4. Sets `/data/.db-ready` flag when restore completes
5. **strapi** process waits for `/data/.db-ready` flag before starting
6. Every 5 minutes, `litestream-sync.sh` does hot restore to temp file and atomic swap

All workers (both us-east-1 and ca-central-1) read from the **same us-east-1 S3 bucket** that the master writes to.

### Tasks
- [ ] 9.1 Deploy worker service to us-east-1
- [ ] 9.2 Deploy worker service to ca-central-1
- [ ] 9.3 Verify workers restore database from S3 on startup (check logs for "Database restored successfully")
- [ ] 9.4 Verify API endpoints serve content at `cms.defcon.run/api/*`
- [ ] 9.5 Wait 5 minutes and verify sync cycle works (check logs for "Sync completed successfully")

## 10. Validation & Documentation
- [ ] 10.1 Test content creation on master, verify it appears on workers after sync
- [x] 10.2 Test media upload, verify CloudFront serves at `cms.defcon.run/{region}/cms/*`
- [ ] 10.3 Document admin access URL and initial credentials
- [ ] 10.4 Document content API endpoints for run.human integration
- [ ] 10.5 Create runbook for failover procedures (promote worker to master)
- [ ] 10.6 Update CLAUDE.md with CMS service information
- [ ] 10.7 Add CMS to CloudWatch dashboards and alarms
