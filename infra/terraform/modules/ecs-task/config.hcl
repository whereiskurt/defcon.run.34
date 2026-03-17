locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/ecs-task"

  # Check if current region should be skipped
  skip_region = contains(local.site_vars.locals.site.skip_regions, local.region_vars.locals.region.full)

  # Derived values for template substitution
  site_domain_slug = replace(local.site_vars.locals.dns.zonename, ".", "-")

  # Transform tasks to replace placeholders:
  #   {{REGION_LABEL}}     -> region label (use1, cac1)
  #   {{REGION}}           -> full region name (us-east-1, ca-central-1)
  #   {{SITE_LABEL}}       -> site label (e.g. dc34)
  #   {{SITE_DOMAIN}}      -> site domain (e.g. defcon.run)
  #   {{SITE_DOMAIN_SLUG}} -> site domain slugified (e.g. defcon-run)
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
                  replace(
                    replace(
                      replace(env.value, "{{REGION_LABEL}}", local.region_vars.locals.region.label),
                      "{{REGION}}", local.region_vars.locals.region.full
                    ),
                    "{{SITE_LABEL}}", local.site_vars.locals.site.label
                  ),
                  "{{SITE_DOMAIN}}", local.site_vars.locals.dns.zonename
                ),
                "{{SITE_DOMAIN_SLUG}}", local.site_domain_slug
              )
            })
          ] : null
          secrets = try(container.secrets, null) != null ? [
            for secret in container.secrets :
            merge(secret, {
              valueFrom = replace(
                replace(
                  replace(secret.valueFrom, "{{REGION_LABEL}}", local.region_vars.locals.region.label),
                  "{{SITE_LABEL}}", local.site_vars.locals.site.label
                ),
                "{{SITE_DOMAIN}}", local.site_vars.locals.dns.zonename
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

      # Logging configuration from site.hcl ecs_tasks block
      enable_logging     = try(local.site_vars.locals.ecs_tasks.enable_logging, true)
      log_retention_days = try(local.site_vars.locals.ecs_tasks.log_retention_days, 7)
    }
  )
}
