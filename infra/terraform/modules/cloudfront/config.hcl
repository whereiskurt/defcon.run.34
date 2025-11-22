locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/cloudfront"

  # Only pass the specific variables that CloudFront module needs
  merged_inputs = {
    site       = local.site_vars.locals.site
    dns        = local.site_vars.locals.dns
    cloudfront = local.site_vars.locals.cloudfront
  }
}
