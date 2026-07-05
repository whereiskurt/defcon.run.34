# Self-contained abuse-detection data plane (Phase 41, us-east-1 only):
# an Athena Glue table over the REAL ALB access logs, the dcr-abuse-analysis
# workgroup (bytes-scanned guardrail), the abuse-detector Lambda + EventBridge
# cron (dedup/escalation), and the findings.jsonl + daily digest — paging the
# operator via the REUSED Phase 40 SNS topic. Mirrors admin-reports' pattern:
# owns its own state key, reads site.hcl, sources the versioned module directly.
#
# SHIPS DARK: excludes-if-disabled below AND schedule_enabled derives from the
# same site.hcl gate, so a merged-but-dark unit provisions nothing and pages no
# one until abuse_detection.enabled is deliberately flipped true.
#
# VALIDATION (Phase 40 lesson #1): validate via a SCOPED `terragrunt plan`
# (modules=abuse-detection, region=us-east-1) — NOT bare `terraform validate`,
# which misses the provider/dependency wiring the include "providers" supplies.

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if abuse_detection is disabled (mirror admin-reports/cloudtrail
# exclude-if-disabled). While false: no Glue table, workgroup, results bucket,
# Lambda, IAM role, or EventBridge rule is created.
exclude {
  if      = !try(local.site_vars.locals.abuse_detection.enabled, false)
  actions = ["all"]
}

# The seam that makes the Glue table read the REAL bucket (Phase 40 lesson #2:
# DERIVE the ALB-log bucket name, never guess it). The mock lets terragrunt
# plan/validate render before the network unit has applied its state.
dependency "network" {
  config_path = "../network"

  mock_outputs = {
    alb_logs_bucket_name = "logs-alb-use1-dc34-mockmock"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Generates provider.tf (with required_providers). The module MUST NOT declare
# its own provider requirements (Phase 40 lesson #1: a second declaration errors
# with "Duplicate required providers configuration").
include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${dirname(find_in_parent_folders("AGENTS.md"))}/infra/terraform/modules/abuse-detection/v1.0.0"
}

inputs = {
  # Identity objects (module reads .label / .random_suffix and .label / .full).
  site = local.site_vars.locals.site
  region = {
    label = "use1"
    full  = "us-east-1"
  }

  # REAL ALB access-log bucket, derived from the network unit's output — the
  # Glue table's storage.location.template points at whatever this resolves to.
  alb_logs_bucket_name = dependency.network.outputs.alb_logs_bucket_name

  # --- Detection thresholds + guardrail, sourced from site.hcl (AD-08) ---
  cron_minutes                = local.site_vars.locals.abuse_detection.cron_minutes
  lookback_hours              = local.site_vars.locals.abuse_detection.lookback_hours
  session_hours               = local.site_vars.locals.abuse_detection.session_hours
  session_gap_min             = local.site_vars.locals.abuse_detection.session_gap_min
  posts_per_5min              = local.site_vars.locals.abuse_detection.posts_per_5min
  requests_per_5min           = local.site_vars.locals.abuse_detection.requests_per_5min
  escalation_multiplier       = local.site_vars.locals.abuse_detection.escalation_multiplier
  digest_hour_utc             = local.site_vars.locals.abuse_detection.digest_hour_utc
  athena_bytes_scanned_cutoff = local.site_vars.locals.abuse_detection.athena_bytes_scanned_cutoff

  # Reuse the Phase 40 SNS topic (module composes the ARN; creates no 2nd topic).
  sns_topic_name = local.site_vars.locals.abuse_detection.sns_topic_name

  # Enabling the unit also enables the cron: the EventBridge rule state derives
  # from the SAME site.hcl gate, so "dark" is dark everywhere.
  schedule_enabled = local.site_vars.locals.abuse_detection.enabled

  tags = {
    Site      = local.site_vars.locals.site.label
    Component = "abuse-detection"
    ManagedBy = "terragrunt"
  }
}
