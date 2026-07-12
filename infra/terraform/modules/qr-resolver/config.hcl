locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/qr-resolver"

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      # Default Lambda source paths. A future live unit runs
      # `npm ci --omit=dev` in each before apply so node_modules/ ships.
      resolver_source_path = "${get_repo_root()}/apps/run.qr/lambda/resolver"
      rollup_source_path   = "${get_repo_root()}/apps/run.qr/lambda/rollup"
    }
  )
}
