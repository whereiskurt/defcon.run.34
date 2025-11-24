locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/ecs-task"

  # Check if current region should be skipped
  skip_region = contains(local.site_vars.locals.site.skip_regions, local.region_vars.locals.region.full)

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      # Extract the tasks list from the new ecs_tasks object structure
      ecs_tasks = local.site_vars.locals.ecs_tasks.tasks
    }
  )
}
