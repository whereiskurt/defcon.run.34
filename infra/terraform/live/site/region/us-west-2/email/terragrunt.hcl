dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/email/config.hcl"
  expose = true
}

## NOTE: Nested includes are not supported by terragrunt.
##       otherwise we'd consider moving this into module
include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  include.module.locals.merged_inputs
)