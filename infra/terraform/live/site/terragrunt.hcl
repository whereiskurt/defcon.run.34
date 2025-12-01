locals {
  site_vars = read_terragrunt_config("site.hcl")
  waf_vars  = read_terragrunt_config("global/waf/waf.hcl")
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
  local.site_vars.locals,
  {
    waf = merge(
      local.site_vars.locals.waf,
      {
        # Use jsondecode(jsonencode()) to normalize types for heterogeneous rulesets
        rulesets = jsondecode(jsonencode(local.waf_vars.locals.waf_rulesets))
      }
    )
  }
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