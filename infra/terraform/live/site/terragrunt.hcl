locals {
  site_vars = read_terragrunt_config("site.hcl")
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/global.hcl"
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/site/config.hcl"
  expose = true
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  local.site_vars.locals
  # local
)

errors {
  retry "transient_network" {
    retryable_errors = concat(
      get_default_retryable_errors(), [
        "(?s).*dial tcp .*: i/o timeout.*",
        "(?s).*connection reset by peer.*",
        "(?s).*context deadline exceeded.*",
        "(?s).*[aA]ccess [dD]enied for [lL]og[dD]estination.*",
      ]
    )

    max_attempts       = 5
    sleep_interval_sec = 10
  }
}