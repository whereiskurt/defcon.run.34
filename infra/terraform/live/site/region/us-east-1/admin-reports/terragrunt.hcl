# Self-contained admin-reports data plane (Phase 40, us-east-1 only):
# metric filters -> DefconRun/Activity, 90-day retention adopted onto the
# existing /ecs/* app log groups via import{}, and the seven saved admin/* Logs
# Insights queries. Mirrors status-site's self-contained regional pattern: owns
# its own state key, reads site.hcl, sources the versioned module directly.

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if admin_reports is disabled (mirror cloudtrail's exclude-if-disabled).
exclude {
  if      = !try(local.site_vars.locals.admin_reports.enabled, false)
  actions = ["all"]
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

  tags = {
    Site      = local.site_vars.locals.site.label
    Component = "admin-reports"
    ManagedBy = "terragrunt"
  }
}
