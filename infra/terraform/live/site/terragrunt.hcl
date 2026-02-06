locals {
  # Compute absolute path from repo root to work correctly with terragrunt --all
  repo_root = dirname(find_in_parent_folders("AGENTS.md"))
  site_vars = read_terragrunt_config("${local.repo_root}/infra/terraform/live/site/site.hcl")
  waf_vars  = read_terragrunt_config("${local.repo_root}/infra/terraform/live/site/global/waf/waf.hcl")
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
        "(?s).*no such host*",
        "(?s).*connection reset by peer.*",
        "(?s).*context deadline exceeded.*",
        "(?s).*request send failed.*",
        "(?s).*[aA]ccess [dD]enied for [lL]og[dD]estination.*",
        "(?s).*bucket must exist.*",
        "(?s).*bucket must have versioning enabled.*",
        # S3 eventual consistency - CORS config not immediately readable after bucket creation
        "(?s).*reading S3 Bucket CORS Configuration.*couldn't find resource.*",
        # AWS provider bug - resource created but identity not returned
        "(?s).*Missing Resource Identity After Create.*",
      ]
    )

    max_attempts       = 6
    sleep_interval_sec = 10
  }
}