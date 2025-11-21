include "module" {
  path   = "${find_in_parent_folders("modules")}/dynamodb/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = include.module.locals.merged_inputs
