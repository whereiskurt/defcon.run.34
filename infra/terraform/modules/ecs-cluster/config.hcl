locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/ecs-cluster"

  # Expand clusters with regions array to flat list with single region per entry
  # Supports both new format (regions = [...]) and legacy format (region = "...")
  # Also applies region_overrides when present
  expanded_clusters = flatten([
    for cluster in local.site_vars.locals.ecs_clusters.clusters : [
      for region in try(cluster.regions, [cluster.region]) :
      merge(
        # Base cluster config (excluding regions array and overrides map)
        { for k, v in cluster : k => v if !contains(["regions", "region_overrides"], k) },
        # Set single region
        { region = region },
        # Apply per-region overrides if defined
        try(cluster.region_overrides[region], {})
      )
    ]
  ])

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      # Pass expanded flat list to module (maintains backward compatibility)
      ecs_clusters = local.expanded_clusters
    }
  )
}
