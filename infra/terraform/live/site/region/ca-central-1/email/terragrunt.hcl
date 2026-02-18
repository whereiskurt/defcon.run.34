# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if email is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  _zone     = local.site_vars.locals.dns.zonename
  _subs     = local.site_vars.locals.dns.subdomains
  _mock_ns  = ["ns-0.awsdns-00.com"]
}

# Exclude if email is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.email.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

# Ensure IAM policy is updated before S3 bucket operations
dependency "github_oidc" {
  config_path  = "${dirname(find_in_parent_folders("site.hcl"))}/global/github-oidc"
  skip_outputs = true

  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
  mock_outputs = {}
}

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = merge(
      {
        (local._zone) = {
          zone_id      = "Z0000000000000000000"
          name         = local._zone
          name_servers = local._mock_ns
        }
      },
      {
        for i, sub in local._subs :
        "${sub}.${local._zone}" => {
          zone_id      = format("Z%019d", i + 1)
          name         = "${sub}.${local._zone}"
          name_servers = local._mock_ns
        }
      }
    )
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}
include "module" {
  path   = "${find_in_parent_folders("modules")}/email/config.hcl"
  expose = true
}

## NOTE: Nested includes are not supported by terragrunt.
##       otherwise we'd consider moving this into module
include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    zone_map = dependency.site.outputs.zone_map
  }
)
