locals {
  site_vars    = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars  = read_terragrunt_config(find_in_parent_folders("region.hcl"))
  secrets_vars = read_terragrunt_config("secrets.hcl")

  module_path = "${find_in_parent_folders("modules/")}/secrets"

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    local.secrets_vars.locals,
    {}
  )
}
