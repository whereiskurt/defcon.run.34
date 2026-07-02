# Changelog

All notable changes to the bib-reconcile-lambda module will be documented in this file.

## [v1.0.0] - 2026-07-02

### Added
- Initial release of bib-reconcile-lambda module (v1.5 Phase 22-03-02).
- Node.js 22.x Lambda function packaged from `apps/run.bib/lambda/reconcile/`.
- CloudWatch Logs group with configurable retention (default 14 days).
- IAM role + inline policy with least-privilege scoping:
  - S3 GetObject on the SES inbox bucket, scoped to the `bib-payments/`
    key prefix (default; configurable via `object_key_prefix`).
  - DynamoDB GetItem / PutItem / UpdateItem / Query on the shared
    `run-human-electro` table, including the `runnerCode-index` GSI ARN.
  - SSM GetParameter on the Anthropic API key path (defaults to
    `/{site}/secrets/{region}/bib/anthropic/*`, overridable via
    `anthropic_api_key_ssm_arn` for exact-ARN scoping).
  - KMS Decrypt on the site-level SSM alias, gated by the
    `PARAMETER_ARN` encryption-context condition so a leaked policy
    cannot decrypt unrelated SecureStrings.
  - SES SendEmail / SendRawEmail from `bibpayment@run.<domain>` to the
    single admin recipient (`defcon.run@gmail.com` by default),
    condition-scoped by `ses:FromAddress` and `ses:Recipients`.
  - X-Ray tracing (Active mode) with matching `xray:Put*` grants.
- S3 → Lambda notification on `ses-inbox-<site>-<region>-<suffix>` bucket
  filtered to `bib-payments/` prefix (contract with Phase 20 SES receive
  rule).
- Reserved concurrent executions default 5 — throttles burst so a stuck
  Haiku loop cannot blow the $20/day budget cap.
- Environment: `RUN_ELECTRO_DBNAME`, `SES_INBOX_BUCKET`,
  `SES_OBJECT_PREFIX`, `ANTHROPIC_API_KEY_SSM_PATH`, `SES_FROM_ADDRESS`,
  `SES_ADMIN_RECIPIENT`, `REGION_LABEL`, plus caller-provided
  `extra_environment`.
- Outputs: `function_name`, `function_arn`, `role_arn`, `log_group_name`,
  `s3_notification_bucket`.

### Notes
- Handler logic is scaffolded stub in Plan 22-03-01. Real Haiku extraction,
  matcher, and budget-cap wiring land in Plan 22-04.
- Terragrunt zip step assumes the caller has run `npm ci --omit=dev`
  inside `source_path` before `terragrunt plan/apply`; the module does
  not orchestrate npm.
- `bib-payments/` prefix is a load-bearing contract with the Phase 20 SES
  receive rule (`infra/terraform/live/site/region/us-east-1/email/email.hcl`).
