locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/mqtt"

  merged_inputs = {
    site = {
      label         = local.site_vars.locals.site.label
      random_suffix = local.site_vars.locals.site.random_suffix
    }
    dns_zonename = local.site_vars.locals.dns.zonename
  }
}
