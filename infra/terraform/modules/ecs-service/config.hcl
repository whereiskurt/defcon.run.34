locals {
  module_path = "${get_repo_root()}/infra/terraform/modules/ecs-service"

  site_config   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_config = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  # Transform services to replace placeholders in health_check_path and listener path_patterns
  # Placeholders:
  #   {{REGION_LABEL}} -> region label (use1, cac1)
  #   {{REGION}}       -> full region name (us-east-1, ca-central-1)
  #   {{SITE_LABEL}}   -> site label (dc34)
  services_with_placeholders = [
    for service in local.site_config.locals.ecs_services.services :
    merge(service, {
      load_balancers = try(service.load_balancers, null) != null ? [
        for lb in service.load_balancers :
        merge(lb, {
          # Replace placeholders in health_check_path
          health_check_path = try(lb.health_check_path, null) != null ? replace(
            replace(
              replace(lb.health_check_path, "{{REGION_LABEL}}", local.region_config.locals.region.label),
              "{{REGION}}", local.region_config.locals.region.full
            ),
            "{{SITE_LABEL}}", local.site_config.locals.site.label
          ) : null,
          listener = try(lb.listener, null) != null ? merge(lb.listener, {
            path_patterns = try(lb.listener.path_patterns, null) != null ? [
              for pattern in lb.listener.path_patterns :
              replace(
                replace(
                  replace(pattern, "{{REGION_LABEL}}", local.region_config.locals.region.label),
                  "{{REGION}}", local.region_config.locals.region.full
                ),
                "{{SITE_LABEL}}", local.site_config.locals.site.label
              )
            ] : null
          }) : null
        })
      ] : null
    })
  ]

  merged_inputs = {
    site         = local.site_config.locals.site
    region       = local.region_config.locals.region
    dns          = local.site_config.locals.dns
    # Use transformed services with region-specific placeholders replaced
    ecs_services = local.services_with_placeholders
  }
}
