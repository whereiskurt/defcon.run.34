locals {
  # Read parent configuration files to access site and region values
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  # Note: ecr_repositories configuration comes from site.hcl
  # This file exists for future region-specific overrides if needed
}
