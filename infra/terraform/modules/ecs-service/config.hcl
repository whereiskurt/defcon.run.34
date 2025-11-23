locals {
  module_path = "${get_repo_root()}/infra/terraform/modules/ecs-service"

  site_config = read_terragrunt_config(find_in_parent_folders("site.hcl"))

  merged_inputs = {
    site           = local.site_config.locals.site
    region         = local.region_config.locals.region
    dns            = local.site_config.locals.dns
    # Extract the services list from the new ecs_services object structure
    ecs_services   = local.site_config.locals.ecs_services.services
  }

  region_config = read_terragrunt_config(find_in_parent_folders("region.hcl"))
}
