# Static host-based ALB redirects (QR service Phase 1): r.defcon.run -> YouTube
# rickroll, h.defcon.run -> run.defcon.run. Pure ALB redirect actions + apex-zone
# ALIAS records; no target group, no ECS. Mirrors abuse-detection's region-level,
# self-contained wiring: owns its state key, reads site.hcl, sources the versioned
# module, depends on network (ALB) and site (zone map).
#
# SHIPS DARK when site.hcl redirects.enabled = false (exclude below -> no rules,
# no records).
#
# VALIDATION: scoped `terragrunt plan` in THIS directory — NOT bare
# `terraform validate` (which misses the generated aliased providers the DNS
# records require).

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

exclude {
  if      = !try(local.site_vars.locals.redirects.enabled, false)
  actions = ["all"]
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    alb_listener_arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/mock/0000000000000000/0000000000000000"
    alb_dns_name     = "mock-alb-1234567890.us-east-1.elb.amazonaws.com"
    alb_zone_id      = "Z35SXDOTRQ7X7K"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = {
      (local.site_vars.locals.dns.zonename) = {
        zone_id      = "Z00000000000000000000"
        name         = local.site_vars.locals.dns.zonename
        name_servers = []
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${dirname(find_in_parent_folders("AGENTS.md"))}/infra/terraform/modules/redirect-rules/v1.0.0"
}

inputs = {
  site = local.site_vars.locals.site
  region = {
    label = "use1"
    full  = "us-east-1"
  }
  dns = {
    zonename = local.site_vars.locals.dns.zonename
  }

  alb_listener_arn = dependency.network.outputs.alb_listener_arn
  alb_dns_name     = dependency.network.outputs.alb_dns_name
  alb_zone_id      = dependency.network.outputs.alb_zone_id
  zone_map         = dependency.site.outputs.zone_map

  redirects = local.site_vars.locals.redirects.rules

  tags = {
    Site      = local.site_vars.locals.site.label
    Component = "redirect-rules"
    ManagedBy = "terragrunt"
  }
}
