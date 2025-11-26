locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/github-oidc"

  merged_inputs = merge(
    local.site_vars.locals,
    {
      github_oidc = local.site_vars.locals.github_oidc
    }
  )
}
