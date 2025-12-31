# Helper to determine if current region should be skipped
# This is included by all regional terragrunt.hcl files

locals {
  site_config   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_config = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  # Check if current region is in the skip list
  should_skip = contains(
    local.site_config.locals.site.skip_regions,
    local.region_config.locals.region.full
  )
}

# Exclude this module if region is in skip_regions list (Terragrunt 0.96+)
exclude {
  if      = local.should_skip
  actions = ["all"]
}
