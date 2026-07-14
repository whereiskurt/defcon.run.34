# bib-reconcile Lambda live unit (v1.5 Phase 22-03-3)
#
# Provisions the SES → Haiku reconciliation Lambda in us-east-1 only. bib
# service is us-east-1-scoped by design (services/run.bib/service.hcl:12
# ecr_repositories.regions = ["us-east-1"]).
#
# DEVIATION FROM PLAN 22-03-3 PATH — PLAN.md called for
#   infra/terraform/live/site/services/run.bib/lambdas/reconcile/terragrunt.hcl
# but that path is outside the region.hcl parent-folder chain, so
# `find_in_parent_folders("region.hcl")` would fail and this unit would
# not resolve region.label. The idiomatic (and working) location is
# region/us-east-1/bib-reconcile/, matching s3-uploads-processor and email.
# Documented in commit body — Rule 3 (auto-fix blocking issue).

include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))
}

# Skip when the region is in site.skip_regions (mirrors the s3-uploads-
# processor and email units — Terragrunt 0.96+ exclude action).
exclude {
  if      = include.skip.locals.should_skip
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/bib-reconcile-lambda/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"

  # Install runtime deps into the Lambda source dir BEFORE terraform zips it
  # (data.archive_file.reconcile). Without this the archive omits node_modules
  # and the Lambda dies on cold start with ERR_MODULE_NOT_FOUND (@anthropic-ai
  # /sdk). Runs on plan too so the planned source_code_hash matches apply.
  # Mirrors the qr-resolver unit's npm_ci hooks.
  before_hook "npm_ci_reconcile" {
    commands    = ["init", "plan", "apply"]
    execute     = ["npm", "ci", "--omit=dev"]
    working_dir = "${get_repo_root()}/apps/run.bib/lambda/reconcile"
  }
}

# Depend on the regional email module for the SES inbox bucket name+ARN.
# Mock outputs are shape-only (no real ARNs) so `terragrunt validate` and
# `terragrunt plan` succeed before the email module has landed state in
# a fresh workspace.
dependency "email" {
  config_path = "../email"

  mock_outputs = {
    received_emails_bucket_name = "ses-inbox-dc34-use1-mockmock"
    received_emails_bucket_arn  = "arn:aws:s3:::ses-inbox-dc34-use1-mockmock"
  }

  mock_outputs_allowed_terraform_commands = [
    "init",
    "validate",
    "plan",
    "destroy",
    "apply",
  ]
  mock_outputs_merge_strategy_with_state = "shallow"
}

# Depend on the shared run-human-electro DynamoDB table for BibReconcile
# + Bib + BudgetCounter writes. Mock output shape mirrors the s3-uploads-
# processor unit.
dependency "dynamodb" {
  config_path = "../dynamodb"

  mock_outputs = {
    tables = {
      "run-human-electro" = {
        table_name        = "run-human-electro"
        table_arn         = "arn:aws:dynamodb:us-east-1:000000000000:table/run-human-electro"
        table_id          = "run-human-electro"
        stream_arn        = ""
        is_primary_region = true
      }
    }
  }

  mock_outputs_allowed_terraform_commands = [
    "init",
    "validate",
    "plan",
    "destroy",
    "apply",
  ]
  mock_outputs_merge_strategy_with_state = "shallow"
}

# Depend on bib-secrets so the anthropic/api_key SSM SecureString is
# guaranteed to exist before this module tries to read it. Skip outputs
# — we compose the ARN deterministically in inputs below.
dependency "bib_secrets" {
  config_path  = "../bib-secrets"
  skip_outputs = true

  mock_outputs_allowed_terraform_commands = [
    "init",
    "validate",
    "plan",
    "destroy",
    "apply",
  ]
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    # Wire in the SES inbox + electro table from dependencies.
    ses_inbox_bucket_name = dependency.email.outputs.received_emails_bucket_name
    ses_inbox_bucket_arn  = dependency.email.outputs.received_emails_bucket_arn

    electro_table_name = dependency.dynamodb.outputs.tables["run-human-electro"].table_name
    electro_table_arn  = dependency.dynamodb.outputs.tables["run-human-electro"].table_arn

    # LOAD-BEARING contract with Phase 20 SES receive rule
    # (infra/terraform/live/site/region/us-east-1/email/email.hcl
    # locals.receive_rules[0].object_key_prefix).
    object_key_prefix = "bib-payments/"

    # Exact-ARN SSM scoping for the Anthropic API key. Preferable to the
    # module's default bib/anthropic/* wildcard because Kurt has already
    # provisioned this specific parameter in bib-secrets/main.tf.
    anthropic_api_key_ssm_arn = "arn:aws:ssm:us-east-1:${get_aws_account_id()}:parameter/dc34/secrets/use1/bib/anthropic/api_key"

    # Verified sender identity from the Phase 20 email module.
    ses_from_address    = "bibpayment@run.${local.site_vars.locals.dns.zonename}"
    ses_admin_recipient = "defcon.run@gmail.com"

    # Sender-allowlist security gate. Sourced from the repo variable so the
    # authorized forwarder addresses never live in source. Fail-closed: if the
    # env var is unset/empty the Lambda rejects every inbound receipt.
    allowed_senders = get_env("TF_VAR_BIB_ALLOWED_SENDERS", "")

    # DMARC gate kill switch. Defaults on; set TF_VAR_BIB_ENFORCE_DMARC=false
    # + apply to disable fast during the event if a legit forward false-rejects.
    enforce_dmarc = get_env("TF_VAR_BIB_ENFORCE_DMARC", "true")
  },
)
