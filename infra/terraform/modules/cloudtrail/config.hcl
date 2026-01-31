locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/cloudtrail"

  merged_inputs = merge(
    local.site_vars.locals,
    {
      cloudtrail = local.site_vars.locals.cloudtrail
    }
  )
}
