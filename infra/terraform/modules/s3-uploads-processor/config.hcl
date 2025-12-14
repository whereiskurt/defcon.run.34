locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/s3-uploads-processor"

  # Collect upload_processors from site configuration
  # No placeholder resolution needed - bucket/table details come from dependencies
  upload_processors = try(local.site_vars.locals.upload_processors.processors, [])

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      upload_processors = local.upload_processors
    }
  )
}
