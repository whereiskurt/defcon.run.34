# Implementation Tasks

## Phase 1: Quick Wins (Can Run in Parallel)

### 1.1 Security Group Descriptions
- [ ] Add description to all ingress rules in `modules/network/v1.0.0/securitygroups.tf`
- [ ] Add description to all egress rules (currently "Allow all outbound traffic")
- [ ] Run `terragrunt plan` to verify no destructive changes

### 1.2 ACM Certificate Lifecycle
- [ ] Add `lifecycle { create_before_destroy = true }` to ACM certificates in `modules/certs/v1.0.0/acm.tf`
- [ ] Verify certificate resources use `for_each` compatible with lifecycle

### 1.3 ECR Security Defaults
- [ ] Change `scan_on_push` default to `true` in `modules/ecr/v1.0.0/variables.tf`
- [ ] Change `image_tag_mutability` default to `"IMMUTABLE"` in `modules/ecr/v1.0.0/variables.tf`
- [ ] Update any explicit `scan_on_push = false` in live configs if they should change

### 1.4 ECS Container Insights
- [ ] Add `setting { name = "containerInsights" value = "enabled" }` to ECS cluster resource
- [ ] Verify no cost concerns (Container Insights has CloudWatch costs)

## Phase 2: KMS Encryption

### 2.1 Create KMS Module
- [ ] Create `modules/kms/v1.0.0/main.tf` with multi-region key support
- [ ] Define key policy allowing ECS, Lambda, CloudWatch Logs usage
- [ ] Add key alias for easy reference
- [ ] Create outputs for key ARN and alias ARN

### 2.2 SSM Parameter Encryption
- [ ] Add `key_id` variable to secrets module
- [ ] Update SSM parameter resources to use KMS key
- [ ] Update live configs to pass KMS key ARN

### 2.3 DynamoDB Encryption + PITR
- [ ] Add `server_side_encryption` block with KMS key to DynamoDB module
- [ ] Add `point_in_time_recovery { enabled = true }` to all tables
- [ ] Update live configs to pass KMS key ARN

### 2.4 S3 Bucket Encryption
- [ ] Change `server_side_encryption_configuration` from AES256 to `aws:kms`
- [ ] Add `kms_master_key_id` variable and pass to encryption config
- [ ] Update bucket policy if needed for KMS

### 2.5 ECR Encryption
- [ ] Set `encryption_configuration.encryption_type = "KMS"` as default
- [ ] Add `encryption_configuration.kms_key` variable
- [ ] Update live configs

### 2.6 Secrets Manager Encryption
- [ ] Add `kms_key_id` to secrets manager resources
- [ ] Update live configs

### 2.7 CloudWatch Logs Encryption
- [ ] Add `kms_key_id` to log group resources in ECS task module
- [ ] Update KMS key policy to allow `logs.amazonaws.com` service principal
- [ ] Update Lambda modules if they create log groups

## Phase 3: Validation

- [ ] Run `terragrunt run-all plan` across all environments
- [ ] Run Checkov scan to verify remediation
- [ ] Document any remaining accepted risks
- [ ] Update security baseline documentation
