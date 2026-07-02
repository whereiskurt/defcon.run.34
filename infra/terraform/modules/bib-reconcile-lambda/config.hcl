locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  module_path = "${find_in_parent_folders("modules/")}/bib-reconcile-lambda"

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    {
      # Default source_path — the live unit can override, but this points
      # to the Lambda scaffold from Plan 22-03-01.
      source_path = "${get_repo_root()}/apps/run.bib/lambda/reconcile"
    }
  )
}
