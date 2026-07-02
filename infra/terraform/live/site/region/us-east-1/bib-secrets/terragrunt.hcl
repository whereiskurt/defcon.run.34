include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

exclude {
  if      = include.skip.locals.should_skip
  actions = ["all"]
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "."
}

inputs = {}
