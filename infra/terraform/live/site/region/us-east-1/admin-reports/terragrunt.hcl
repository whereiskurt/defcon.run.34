# Self-contained admin-reports data plane (Phase 40, us-east-1 only):
# metric filters -> DefconRun/Activity, 90-day retention adopted onto the
# existing /ecs/* app log groups via import{}, the seven saved admin/* Logs
# Insights queries (40-04), plus the admin-reports dashboard + four SNS tripwire
# alarms (40-06). Mirrors status-site's self-contained regional pattern: owns
# its own state key, reads site.hcl, sources the versioned module directly.

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if admin_reports is disabled (mirror cloudtrail's exclude-if-disabled).
exclude {
  if      = !try(local.site_vars.locals.admin_reports.enabled, false)
  actions = ["all"]
}

# The dashboard ALB/CloudFront widgets and both ALB alarms plot identifiers they
# are GIVEN — the module cannot self-discover them. Wire them from the sibling
# units. mock_outputs let `terragrunt validate/plan` render before those units
# apply. arn_suffix (the CloudWatch dimension value) is derived in inputs below.
dependency "network" {
  config_path = "../network"

  mock_outputs = {
    alb_arn = "arn:aws:elasticloadbalancing:us-east-1:000000000000:loadbalancer/app/mock-alb/0123456789abcdef"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "ecs_service" {
  config_path = "../ecs-service"

  # target_groups: key -> { arn, id, name, port, protocol }. Only .arn is read.
  mock_outputs = {
    target_groups = {
      run-auth  = { arn = "arn:aws:elasticloadbalancing:us-east-1:000000000000:targetgroup/mock-auth/0123456789abcdef" }
      run-gpx   = { arn = "arn:aws:elasticloadbalancing:us-east-1:000000000000:targetgroup/mock-gpx/0123456789abcdef" }
      run-human = { arn = "arn:aws:elasticloadbalancing:us-east-1:000000000000:targetgroup/mock-human/0123456789abcdef" }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "cloudfront" {
  config_path = "../cloudfront"

  # distribution_ids: domain -> CloudFront distribution id (six domains).
  mock_outputs = {
    distribution_ids = {
      auth  = "E00000000AUTH"
      run   = "E000000000RUN"
      cms   = "E00000000CMS0"
      gpx   = "E00000000GPX0"
      flash = "E0000000FLASH"
      bib   = "E00000000BIB0"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${dirname(find_in_parent_folders("AGENTS.md"))}/infra/terraform/modules/admin-reports/v1.0.0"
}

inputs = {
  site_label = local.site_vars.locals.site.label

  # Real /ecs/* group names discovered from the ecs-task naming convention
  # (`/ecs/{container.name}-{family}`) and recorded in site.hcl.admin_reports.
  log_group_names    = local.site_vars.locals.admin_reports.log_group_names
  log_retention_days = local.site_vars.locals.admin_reports.log_retention_days

  # --- Dashboard/alarm identifier dimensions (40-06) ---
  # arn_suffix is the CloudWatch dimension value, derived from the units' arns:
  #   ALB LoadBalancer dim = arn with `arn:...:loadbalancer/` stripped -> `app/<name>/<hash>`
  #   TargetGroup dim      = arn resource part (split on ':')          -> `targetgroup/<name>/<hash>`
  #   DistributionId dim   = the cloudfront unit's distribution id directly
  alb_arn_suffix = try(element(split("loadbalancer/", dependency.network.outputs.alb_arn), 1), "")
  target_group_arn_suffixes = try({
    for k, tg in dependency.ecs_service.outputs.target_groups : k => element(split(":", tg.arn), 5)
  }, {})
  cloudfront_distribution_ids = try(dependency.cloudfront.outputs.distribution_ids, {})

  # --- Tripwire thresholds + SNS email (40-06), sourced from site.hcl ---
  # con-week is a one-line bump in site.hcl.admin_reports (RUNBOOK 40-05).
  sns_alarm_email                = local.site_vars.locals.admin_reports.alert_email
  threshold_signups_per_hour     = local.site_vars.locals.admin_reports.thresholds.signups_per_hour
  threshold_gpx_uploads_per_hour = local.site_vars.locals.admin_reports.thresholds.gpx_uploads_per_hour
  threshold_alb_5xx_per_5min     = local.site_vars.locals.admin_reports.thresholds.alb_5xx_per_5min

  tags = {
    Site      = local.site_vars.locals.site.label
    Component = "admin-reports"
    ManagedBy = "terragrunt"
  }
}
