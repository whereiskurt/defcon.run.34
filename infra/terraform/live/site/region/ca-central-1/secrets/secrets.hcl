locals {
  # Read parent configuration files to access site and region values
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  # Extract values for easier reference
  region_label = local.region_vars.locals.region.label
}
