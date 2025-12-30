# Tasks: Add Strapi CMS with Litestream Replication

## 1. Service Definition (service.hcl)
- [ ] 1.1 Create `infra/terraform/live/site/services/cms/` directory
- [ ] 1.2 Create `service.hcl` with ECR repository definitions (cms-nginx, cms-webapp)
- [ ] 1.3 Define master task in service.hcl (nginx + webapp with supervisord running strapi + litestream replicate)
- [ ] 1.4 Define worker task in service.hcl (nginx + webapp with supervisord running strapi + litestream restore/sync)
- [ ] 1.5 Define `cms_storage` for S3 buckets (litestream + media) using `user_uploads` pattern
- [ ] 1.6 Define master service (us-east-1, desired_count=1, no autoscaling)
- [ ] 1.7 Define worker service (both regions, autoscaling enabled)
- [ ] 1.8 Add VERSION.nginx and VERSION.webapp files

## 2. Site.hcl Integration
- [ ] 2.1 Add `ecs_cms_service = read_terragrunt_config("./services/cms/service.hcl")` to site.hcl
- [ ] 2.2 Add `"cms"` to `cloudfront.domains` list
- [ ] 2.3 Add `"cms"` to `dns.subdomains` list
- [ ] 2.4 Add CMS ECR repositories to `ecr.repositories` concat
- [ ] 2.5 Add CMS tasks to `ecs_tasks.tasks` concat
- [ ] 2.6 Add CMS services to `ecs_services.services` concat
- [ ] 2.7 Add CMS storage to `user_uploads.buckets` concat
- [ ] 2.8 Add `strapi` to `secrets.definitions` with keys: admin_jwt_secret, api_token_salt, app_keys, transfer_token_salt, oidc_client_id, oidc_client_secret

## 3. Secrets & OIDC Configuration
- [ ] 3.1 Generate Strapi secrets (`openssl rand -base64 32` for each)
- [ ] 3.2 Register CMS as OIDC client in auth.defcon.run oidc-provider config
- [ ] 3.3 Generate oidc_client_id and oidc_client_secret for CMS client
- [ ] 3.4 Add all strapi secrets to `.secrets.json`:
  - admin_jwt_secret, api_token_salt, app_keys, transfer_token_salt
  - oidc_client_id, oidc_client_secret
- [ ] 3.5 Encrypt with `sops --encrypt .secrets.json > .secrets.sops.json`
- [ ] 3.6 Verify secrets module will create SSM parameters at `/dc34/secrets/{region}/strapi/*`

## 4. Terraform Apply
- [ ] 4.1 Run `terragrunt run-all plan` to verify configuration
- [ ] 4.2 Verify ECR repositories will be created via `modules/ecr`
- [ ] 4.3 Verify S3 buckets will be created via `modules/s3-uploads`
- [ ] 4.4 Verify CloudFront will include cms.defcon.run via `modules/cloudfront`
- [ ] 4.5 Verify ACM certificate will be requested for cms.defcon.run
- [ ] 4.6 Run `terragrunt run-all apply` to create infrastructure

## 5. Application - Strapi Setup
- [ ] 5.1 Create `apps/run.cms/` directory structure
- [ ] 5.2 Initialize Strapi project with `npx create-strapi-app@latest strapi --quickstart --no-run`
- [ ] 5.3 Configure SQLite database in `config/database.js`
- [ ] 5.4 Install `@strapi/provider-upload-aws-s3` and configure in `config/plugins.js`
- [ ] 5.5 Configure OIDC SSO provider in `config/plugins.js` (auth.defcon.run endpoints)
- [ ] 5.6 Create services claim validation middleware (`src/middlewares/oidc-services-check.js`)
- [ ] 5.7 Configure server settings in `config/server.js` (port 1337, host 0.0.0.0)
- [ ] 5.8 Create initial content types: Page, Announcement, Event
- [ ] 5.9 Configure CORS for defcon.run domains in `config/middlewares.js`

## 6. Application - Docker Images
- [ ] 6.1 Create `apps/run.cms/nginx/Dockerfile` (copy from auth/run-human, adjust proxy target to port 1337)
- [ ] 6.2 Create `apps/run.cms/nginx/nginx.conf` (TLS termination, proxy to webapp:1337)
- [ ] 6.3 Create `apps/run.cms/webapp/Dockerfile` (Node.js + Strapi + Litestream + supervisord)
- [ ] 6.4 Create `supervisord.master.conf` (runs litestream replicate + strapi)
- [ ] 6.5 Create `supervisord.worker.conf` (runs litestream-sync.sh + strapi)
- [ ] 6.6 Create `litestream.master.yml` (replicate mode, sync-interval=1s)
- [ ] 6.7 Create `litestream.worker.yml` (restore mode)
- [ ] 6.8 Create `litestream-sync.sh` (initial restore + 5-min sync loop)
- [ ] 6.9 Create `apps/run.cms/VERSION.nginx` and `apps/run.cms/VERSION.webapp`

## 7. Build Scripts
- [ ] 7.1 Verify `apps/build.sh` works with new service (test with `./apps/build.sh nginx run.cms`)
- [ ] 7.2 Verify `apps/build.sh` works with webapp (test with `./apps/build.sh webapp run.cms`)
- [ ] 7.3 Build and push nginx image to ECR in both regions
- [ ] 7.4 Build and push webapp image to ECR in both regions

## 8. Deployment - Master
- [ ] 8.1 Update VERSION files to trigger ECS deployment
- [ ] 8.2 Run `./apps/deploy.sh run.cms use1` to deploy master
- [ ] 8.3 Verify Strapi admin panel redirects to auth.defcon.run for OIDC login
- [ ] 8.4 Verify user with `services: ["cms"]` claim can access admin
- [ ] 8.5 Verify user without `cms` service claim is denied access
- [ ] 8.6 Verify Litestream is replicating to S3 bucket

## 9. Deployment - Workers
- [ ] 9.1 Deploy worker service to us-east-1
- [ ] 9.2 Deploy worker service to ca-central-1
- [ ] 9.3 Verify workers restore database from S3 on startup
- [ ] 9.4 Verify API endpoints serve content at `cms.defcon.run/api/*`
- [ ] 9.5 Wait 5 minutes and verify sync cycle works

## 10. Validation & Documentation
- [ ] 10.1 Test content creation on master, verify it appears on workers after sync
- [ ] 10.2 Test media upload, verify CloudFront serves at `cms.defcon.run/uploads/*`
- [ ] 10.3 Document admin access URL and initial credentials
- [ ] 10.4 Document content API endpoints for run.human integration
- [ ] 10.5 Create runbook for failover procedures (promote worker to master)
- [ ] 10.6 Update CLAUDE.md with CMS service information
- [ ] 10.7 Add CMS to CloudWatch dashboards and alarms
