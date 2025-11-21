locals {
  site_vars     = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars   = read_terragrunt_config(find_in_parent_folders("region.hcl"))
  dynamodb_vars = read_terragrunt_config("dynamodb.hcl")

  module_path = "${find_in_parent_folders("modules/")}/dynamodb"

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    local.dynamodb_vars.locals,
    {}
  )
}
