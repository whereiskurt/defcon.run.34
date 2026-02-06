locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/ec2spot"

  # Expand instances with regions array to flat list with single region per entry
  # Supports both new format (regions = [...]) and legacy format (region = "...")
  # Also applies region_overrides when present
  expanded_ec2spots = flatten([
    for instance in local.site_vars.locals.ec2spots.instances : [
      for region in try(instance.regions, [instance.region]) :
      merge(
        # Base instance config (excluding regions array and overrides map)
        { for k, v in instance : k => v if !contains(["regions", "region_overrides"], k) },
        # Set single region
        { region = region },
        # Apply per-region overrides if defined
        try(instance.region_overrides[region], {})
      )
    ]
  ])

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      # Pass expanded flat list to module (maintains backward compatibility)
      ec2spots = local.expanded_ec2spots
    }
  )
}
