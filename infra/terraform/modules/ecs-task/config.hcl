locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/ecs-task"

  # Check if current region should be skipped
  skip_region = contains(local.site_vars.locals.site.skip_regions, local.region_vars.locals.region.full)

  # Transform tasks to replace placeholders:
  #   {{REGION_LABEL}} -> region label (use1, cac1)
  #   {{REGION}}       -> full region name (us-east-1, ca-central-1)
  #   {{SITE_LABEL}}   -> site label (dc34)
  tasks_with_region_placeholders = [
    for task in local.site_vars.locals.ecs_tasks.tasks :
    merge(task, {
      containers = [
        for container in task.containers :
        merge(container, {
          environment = try(container.environment, null) != null ? [
            for env in container.environment :
            merge(env, {
              value = replace(
                replace(
                  replace(env.value, "{{REGION_LABEL}}", local.region_vars.locals.region.label),
                  "{{REGION}}", local.region_vars.locals.region.full
                ),
                "{{SITE_LABEL}}", local.site_vars.locals.site.label
              )
            })
          ] : null
          secrets = try(container.secrets, null) != null ? [
            for secret in container.secrets :
            merge(secret, {
              valueFrom = replace(
                replace(secret.valueFrom, "{{REGION_LABEL}}", local.region_vars.locals.region.label),
                "{{SITE_LABEL}}", local.site_vars.locals.site.label
              )
            })
          ] : null
        })
      ]
    })
  ]

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      # Use transformed tasks with region-specific placeholders replaced
      ecs_tasks = local.tasks_with_region_placeholders
    }
  )
}
