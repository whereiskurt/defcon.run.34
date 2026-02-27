# Change: Harden Infrastructure Security (Checkov Remediation)

## Why

Checkov IaC security scan identified 151 failed checks. While many are low-severity or require architectural decisions, a significant portion are "low-hanging fruit" that can be addressed with minimal risk and effort to improve our security posture.

## What Changes

### Phase 1: Quick Wins (Low Risk, Immediate Value)

- **Security group rule descriptions** - Add `description` to all ingress/egress rules (CKV_AWS_23, CKV_AWS_382)
- **ACM certificate lifecycle** - Add `create_before_destroy = true` for zero-downtime renewals (CKV_AWS_233)
- **ECR defaults** - Enable `scan_on_push` and set `image_tag_mutability = "IMMUTABLE"` by default (CKV_AWS_163, CKV_AWS_51)
- **ECS container insights** - Enable CloudWatch Container Insights on ECS clusters (CKV_AWS_65)

### Phase 2: KMS Encryption (Medium Effort, High Value)

- **Create shared KMS key module** - Centralized key management with proper key policies
- **SSM Parameter encryption** - Use KMS CMK for SecureString parameters (CKV_AWS_337, CKV2_AWS_34)
- **DynamoDB encryption** - Use KMS CMK instead of AWS-managed key (CKV_AWS_119)
- **DynamoDB PITR** - Enable point-in-time recovery for disaster recovery (CKV_AWS_28)
- **S3 bucket encryption** - Use KMS instead of AES256 (CKV_AWS_145)
- **ECR encryption** - Use KMS for repository encryption (CKV_AWS_136)
- **Secrets Manager encryption** - Use KMS CMK (CKV_AWS_149)
- **CloudWatch Logs encryption** - Encrypt log groups with KMS (CKV_AWS_158)

### Phase 3: Deferred (Requires Design Decisions)

These items are noted but not addressed in this proposal:

| Check | Reason Deferred |
|-------|-----------------|
| CKV_AWS_374 | CloudFront geo restriction - needs geo policy decision |
| CKV_AWS_310 | CloudFront origin failover - needs origin group architecture |
| CKV_AWS_117 | Lambda in VPC - significant networking change |
| CKV_AWS_192 | WAF Log4j rules - needs managed rule configuration |
| CKV_AWS_273 | SSO vs IAM users - intentional for CI/CD OIDC |

### Accepted Risks

| Check | Reason Accepted |
|-------|-----------------|
| CKV_AWS_24 | SSH from 0.0.0.0/0 - bastion access pattern |
| CKV_AWS_40 | IAM user policies - CI/CD automation users |

## Impact

- **Affected modules**: network, certs, ecr, ecs-task, secrets, dynamodb, s3-uploads
- **Breaking changes**: None - all changes are additive or default changes
- **Cost impact**: KMS key usage costs (~$1/month per key + $0.03 per 10k requests)
- **Testing required**: `terragrunt run-all plan` to verify no unintended changes

## Specs Affected

Creates new spec: `infra-security` documenting security baseline requirements.
