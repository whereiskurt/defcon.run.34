# Tasks: Standardize Naming Convention

Since the AWS account is fresh with no existing resources, all changes can be made in one atomic update.

## 1. Local Development Files

### 1.1 Docker Compose
- [ ] Rename `human-run-localhost` to `run-human-localhost` in docker-compose.yaml
- [ ] Rename `human-auth-localhost` to `run-auth-localhost` in docker-compose.yaml

### 1.2 DynamoDB Init Script
- [ ] Fix comment on line 170: "human.run" → "run-auth"
- [ ] Fix table name on line 207: `human.run` → `run-auth`
- [ ] Fix comment on line 210: "human.auth" → "run-auth"

### 1.3 Package.json Names
- [ ] Update run.auth/webapp/package.json: `"auth"` → `"run-auth"`
- [ ] Update run.human/webapp/package.json: `"run"` → `"run-human"`

## 2. Build Scripts

### 2.1 build.sh
- [ ] Change REPO_PREFIX for auth: `dc34-auth` → `dc34-run-auth`
- [ ] Change REPO_PREFIX for cms: `dc34-cms` → `dc34-run-cms`

### 2.2 release-all.sh
- [ ] Change get_tf_service mapping: `"auth"` → `"run-auth"`
- [ ] Change get_tf_service mapping: `"cms"` → `"run-cms"`

## 3. Infrastructure Configuration

### 3.1 Rename Service Directories
- [ ] Rename `services/auth/` → `services/run-auth/`
- [ ] Rename `services/cms/` → `services/run-cms/`

### 3.2 Update run-auth/service.hcl
- [ ] ECR container names: `auth-nginx` → `run-auth-nginx`
- [ ] ECR container names: `auth-app` → `run-auth-app`
- [ ] ECS task family: `auth` → `run-auth`
- [ ] ECS service name: `auth` → `run-auth`

### 3.3 Update run-cms/service.hcl
- [ ] ECR container names: `cms-nginx` → `run-cms-nginx`
- [ ] ECR container names: `cms-app` → `run-cms-app`
- [ ] ECS task family: `cms-master` → `run-cms-master`
- [ ] ECS task family: `cms-worker` → `run-cms-worker`
- [ ] ECS service names: update to `run-cms-*`
- [ ] S3 bucket names: `cms-litestream` → `dc34-run-cms-litestream`
- [ ] S3 bucket names: `cms-media` → `dc34-run-cms-media`

### 3.4 Update References
- [ ] Update site.hcl if it references service directories
- [ ] Update any SSM parameter paths that use old names

## 4. Validation

- [ ] Run `docker compose up` - verify local dev works
- [ ] Run `npm install` in all apps
- [ ] Run `terragrunt hclfmt` - verify HCL formatting
- [ ] Run `terragrunt run-all validate` - verify terraform config
- [ ] Review `terragrunt run-all plan` output before first deploy
