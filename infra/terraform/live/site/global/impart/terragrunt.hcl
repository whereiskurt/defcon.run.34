# Impart Security provider unit — INERT scaffold from the 2026-07-22 spike
# (docs/superpowers/specs/2026-07-22-impart-terraform-provider-findings.md).
# Excluded until impart.provider_managed = true in impart.hcl, so plan --all
# never inits the impart provider while no IMPART token exists in sops.
#
# Deliberately does NOT include providers/global.hcl: that include generates
# aws provider blocks plus a required_providers block that collides with this
# module's own (which must pin impart-security/impart), and this unit manages
# no aws resources. The remote_state below mirrors global.hcl's pattern.
locals {
  impart_vars = read_terragrunt_config(find_in_parent_folders("impart.hcl"))

  is_ci             = get_env("CI", "") == "true"
  profile_prefix    = get_env("TF_VAR_profile_prefix", "")
  terraform_profile = local.profile_prefix != "" ? "${local.profile_prefix}-terraform" : "terraform"
}

exclude {
  if      = !try(local.impart_vars.locals.impart.provider_managed, false)
  actions = ["all"]
}

remote_state {
  backend = "s3"
  config = merge(
    {
      encrypt        = true
      bucket         = get_env("TG_BUCKET_USE1", "")
      key            = "use1/global/impart/tf.global.tfstate"
      region         = "us-east-1"
      dynamodb_table = get_env("TG_TABLE_USE1", "")
    },
    local.is_ci ? {} : { profile = local.terraform_profile }
  )
  generate = {
    path      = "backend.globals.tf"
    if_exists = "overwrite_terragrunt"
  }
}

terraform {
  source = "${find_in_parent_folders("modules/")}/impart/v1.0.0"
}

inputs = {
  # Populated when the unit is enabled; see the findings doc Kurt-gates.
  # impart_api_token from .secrets.sops.json '["impart_api_token"]'
  apps = {}
}
