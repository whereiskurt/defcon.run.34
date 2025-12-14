locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/s3-uploads"

  # Collect user_uploads from site configuration
  # These are aggregated from all service.hcl files
  merged_user_uploads = try(local.site_vars.locals.user_uploads.buckets, [])

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      user_uploads = local.merged_user_uploads
    }
  )
}
